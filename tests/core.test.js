import { test } from 'node:test';
import assert from 'node:assert/strict';
import { zonedToEpoch, getZonedParts, localParts, parseDateTimeInput, formatDateTime, toIsoZoned, formatOffset, getOffsetMs } from '../src/core/time.js';
import { buildRange } from '../src/core/audit.js';
import { filterScrobbles, sortScrobbles, groupScrobbles, inTimeWindow } from '../src/core/filters.js';
import { computeStats } from '../src/core/stats.js';
import { toCSV, csvEscape } from '../src/core/export.js';
import { encodeScrobbles, decodeScrobbles } from '../src/core/storage.js';
import { ScrobbleCollector, annotateGaps } from '../src/core/model.js';
import { LastfmClient, mapApiError } from '../src/sources/lastfm/client.js';
import { RateLimiter } from '../src/core/rateLimiter.js';
import { fmtPercent } from '../src/ui/dom.js';

const SP = 'America/Sao_Paulo';

test('wall time -> epoch em São Paulo (UTC−3, sem horário de verão)', () => {
  const r = zonedToEpoch({ year: 2026, month: 10, day: 5, hour: 8, minute: 0, second: 0 }, SP);
  assert.equal(r.valid, true);
  assert.equal(new Date(r.epochMs).toISOString(), '2026-10-05T11:00:00.000Z');
});

test('lacuna e sobreposição de horário de verão (New York)', () => {
  const gap = zonedToEpoch({ year: 2026, month: 3, day: 8, hour: 2, minute: 30 }, 'America/New_York');
  assert.equal(gap.valid, false);
  const overlap = zonedToEpoch({ year: 2026, month: 11, day: 1, hour: 1, minute: 30 }, 'America/New_York');
  assert.equal(overlap.valid, true);
  assert.equal(new Date(overlap.epochMs).toISOString(), '2026-11-01T05:30:00.000Z'); // primeira ocorrência (EDT)
});

test('localParts (cacheado) bate com Intl em vários timezones', () => {
  const zones = ['UTC', SP, 'America/New_York', 'Europe/London', 'Asia/Kathmandu', 'Australia/Lord_Howe', 'Pacific/Chatham'];
  for (const tz of zones) {
    for (let t = 1_767_225_600; t < 1_798_761_600; t += 86_400 * 3 + 1234) {
      const a = getZonedParts(t * 1000, tz);
      const b = localParts(t, tz);
      for (const k of ['year', 'month', 'day', 'hour', 'minute', 'second', 'weekday']) assert.equal(b[k], a[k], `${tz} ${t} ${k}`);
    }
  }
});

test('parse e formatação', () => {
  assert.equal(parseDateTimeInput('2026-02-30T10:00'), null);
  assert.deepEqual(parseDateTimeInput('2026-10-05T08:00'), { year: 2026, month: 10, day: 5, hour: 8, minute: 0, second: 0 });
  const ts = 1_791_198_000;
  assert.equal(formatDateTime(ts, SP), '05/10/2026 08:00:00');
  assert.equal(toIsoZoned(ts, SP), '2026-10-05T08:00:00-03:00');
  assert.equal(formatOffset(getOffsetMs(ts * 1000, SP)), 'UTC−03:00');
});

test('buildRange: fim inclusivo vs exclusivo', () => {
  const inc = buildRange({ startInput: '2026-10-05T08:00', endInput: '2026-10-05T13:00', timeZone: SP, inclusiveEnd: true });
  assert.equal(inc.from, 1_791_198_000);
  assert.equal(inc.to, 1_791_198_000 + 5 * 3600);
  const exc = buildRange({ startInput: '2026-10-05T08:00', endInput: '2026-10-05T13:00', timeZone: SP, inclusiveEnd: false });
  assert.equal(exc.to, inc.to - 1);
  assert.throws(() => buildRange({ startInput: '2026-10-05T13:00', endInput: '2026-10-05T08:00', timeZone: SP }));
});

const S = (ts, artist, track, album = '') => ({ id: String(ts) + track, source: 'lastfm', ts, artist, track, album });
const base = 1_791_198_000;
const list = annotateGaps([
  S(base + 4000, 'Björk', 'Jóga', 'Homogenic'),
  S(base + 3990, 'Björk', 'Jóga', 'Homogenic'),
  S(base + 2000, 'Radiohead', 'Creep', 'Pablo Honey'),
  S(base + 10, 'Radiohead', 'Karma Police', 'OK Computer'),
  S(base, 'Björk', 'Hyperballad'),
]);

test('filtros de texto (sem acento), horário e reproduções', () => {
  assert.equal(filterScrobbles(list, { artist: 'bjork' }, { timeZone: SP }).length, 3);
  assert.equal(filterScrobbles(list, { track: 'joga', exact: true }, { timeZone: SP }).length, 2);
  assert.equal(filterScrobbles(list, { query: 'ok comp' }, { timeZone: SP }).length, 1);
  // 08:00:00–08:30:00 local
  assert.equal(filterScrobbles(list, { timeFrom: '08:00', timeTo: '08:30' }, { timeZone: SP }).length, 2);
  assert.equal(filterScrobbles(list, { playsMin: 2 }, { timeZone: SP }).length, 2);
  assert.equal(filterScrobbles(list, { shortGapOnly: true }, { timeZone: SP }).length, 4);
  assert.equal(filterScrobbles(list, { dateFrom: '2026-10-06' }, { timeZone: SP }).length, 0);
});

test('janela de horário atravessando a meia-noite', () => {
  assert.equal(inTimeWindow(23 * 3600, 22 * 3600, 2 * 3600), true);
  assert.equal(inTimeWindow(1 * 3600, 22 * 3600, 2 * 3600), true);
  assert.equal(inTimeWindow(12 * 3600, 22 * 3600, 2 * 3600), false);
});

test('ordenação e agrupamento', () => {
  assert.equal(sortScrobbles(list, 'time_asc')[0].track, 'Hyperballad');
  assert.equal(sortScrobbles(list, 'plays_desc')[0].track, 'Jóga');
  const g = groupScrobbles(list, 'track');
  assert.equal(g.find((x) => x.track === 'Jóga').count, 2);
  assert.equal(groupScrobbles(list, 'album').length, 3); // sem álbum fica de fora
});

test('estatísticas', () => {
  const st = computeStats(list, { timeZone: SP, range: { from: base, to: base + 5 * 3600 } });
  assert.equal(st.total, 5);
  assert.equal(st.uniqueTracks, 4);
  assert.equal(st.uniqueArtists, 2);
  assert.equal(st.topTracks[0].track, 'Jóga');
  assert.equal(st.topArtists[0].artist, 'Björk');
  assert.equal(st.timeline.unit, 'hour');
  assert.equal(st.timeline.buckets.reduce((a, b) => a + b.count, 0), 5);
  assert.equal(st.byHour[8], 3);
  assert.equal(st.byHour[9], 2);
});

test('CSV escapa delimitador, aspas, quebras e fórmulas', () => {
  assert.equal(csvEscape('a,b', ','), '"a,b"');
  assert.equal(csvEscape('say "hi"', ','), '"say ""hi"""');
  assert.equal(csvEscape('=SUM(A1)', ','), "'=SUM(A1)");
  const csv = toCSV([{ a: 1, b: 'x;y' }], { delimiter: ';' });
  assert.equal(csv, '﻿a;b\r\n1;"x;y"\r\n');
});

test('codificação compacta ida e volta', () => {
  const full = list.map((s) => ({ ...s, artistMbid: '', trackMbid: '', albumMbid: '', url: 'u', image: '' }));
  const back = decodeScrobbles(JSON.parse(JSON.stringify(encodeScrobbles(full))));
  assert.deepEqual(
    back,
    full.map(({ gapPrev, gapNext, ...rest }) => rest),
  );
});

test('collector: multiplicidade máxima por resposta', () => {
  const c = new ScrobbleCollector();
  const a = S(1, 'A', 'T');
  c.addBatch([a, a]);
  c.addBatch([a]); // releitura parcial não duplica
  assert.equal(c.size, 2);
  c.addBatch([a, a, a]);
  assert.equal(c.size, 3);
});

test('cliente: mapeia erros e retenta rate limit / 5xx', async () => {
  assert.equal(mapApiError(6, 'User not found').kind, 'user_not_found');
  assert.equal(mapApiError(17, 'Login required').kind, 'private_profile');
  assert.equal(mapApiError(10, 'Invalid API key').kind, 'invalid_api_key');
  let n = 0;
  const responses = [
    () => ({ status: 200, body: { error: 29, message: 'Rate limit exceeded' } }),
    () => ({ status: 503, body: null }),
    () => ({ status: 200, body: { recenttracks: { track: { name: 'X', artist: { '#text': 'A' }, album: { '#text': '' }, date: { uts: '1' } }, '@attr': { total: '1', totalPages: '1', page: '1', perPage: '200' } } } }),
  ];
  const fetchImpl = async () => {
    const r = responses[n++]();
    return { status: r.status, ok: r.status < 400, json: async () => (r.body === null ? Promise.reject(new Error('x')) : r.body) };
  };
  const limiter = new RateLimiter({ minIntervalMs: 0, sleep: async () => {} });
  const c = new LastfmClient({ apiKey: 'k', fetchImpl, limiter, sleep: async () => {} });
  const res = await c.getRecentTracks({ user: 'u', from: 0, to: 2 });
  assert.equal(res.tracks.length, 1); // objeto único vira array
  assert.equal(c.retryCount, 2);

  const c2 = new LastfmClient({ apiKey: 'k', limiter, sleep: async () => {}, fetchImpl: async () => ({ status: 200, ok: true, json: async () => ({ error: 6, message: 'User not found' }) }) });
  await assert.rejects(c2.getUserInfo('nobody'), (e) => e.kind === 'user_not_found');
});

test('porcentagem nunca arredonda para 100% (ou 0%) quando não é exato', () => {
  assert.equal(fmtPercent(2358, 2363), '99,7%');
  assert.equal(fmtPercent(2363, 2363), '100%');
  assert.equal(fmtPercent(0, 10), '0%');
  assert.equal(fmtPercent(1, 100000), 'menos de 0,1%');
  assert.equal(fmtPercent(48, 52), '92,3%');
  assert.equal(fmtPercent(1, 2), '50%');
  assert.equal(fmtPercent(5, 0), '—');
});
