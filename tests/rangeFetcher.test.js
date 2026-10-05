import { test } from 'node:test';
import assert from 'node:assert/strict';
import { RangeFetcher, normalizeTrack } from '../src/sources/lastfm/source.js';
import { FakeLastfm, generate, makeTrack, multiset } from './fakeLastfm.js';

const noSleep = async () => {};
const FROM = 1_791_198_000; // 2026-10-05 08:00 America/Sao_Paulo
const TO = FROM + 5 * 3600; // 13:00

async function fetchAll(api, from = FROM, to = TO, opts = {}) {
  const f = new RangeFetcher({ client: api, user: 'u', from, to, sleep: noSleep, ...opts });
  return f.run();
}

function expectExact(result, data, from = FROM, to = TO) {
  const expected = multiset(data.filter((d) => d.ts >= from && d.ts <= to));
  const got = multiset(result.scrobbles);
  assert.equal(result.scrobbles.length, [...expected.values()].reduce((a, b) => a + b, 0), 'quantidade');
  assert.deepEqual(got, expected);
  for (const s of result.scrobbles) assert.ok(s.ts >= from && s.ts <= to, 'fora do intervalo');
}

for (const fromInclusive of [true, false]) {
  for (const toInclusive of [true, false]) {
    test(`intervalo exato com bordas (from ${fromInclusive ? '>=' : '>'}, to ${toInclusive ? '<=' : '<'})`, async () => {
      const data = [
        ...generate(1500, FROM - 3600, TO + 3600),
        makeTrack(FROM - 1, 'Edge', 'Before'),
        makeTrack(FROM, 'Edge', 'Start'),
        makeTrack(TO, 'Edge', 'End'),
        makeTrack(TO + 1, 'Edge', 'After'),
      ];
      const api = new FakeLastfm(data, { fromInclusive, toInclusive });
      const r = await fetchAll(api);
      expectExact(r, data);
      assert.equal(r.verification.status, 'verified');
      assert.ok(r.scrobbles.some((s) => s.track === 'Start'));
      assert.ok(r.scrobbles.some((s) => s.track === 'End'));
      assert.ok(!r.scrobbles.some((s) => s.track === 'Before' || s.track === 'After'));
    });
  }
}

test('intervalo vazio', async () => {
  const api = new FakeLastfm(generate(100, FROM - 9000, FROM - 10));
  const r = await fetchAll(api);
  assert.equal(r.scrobbles.length, 0);
  assert.equal(r.verification.status, 'verified');
});

test('volume grande com fatias paralelas', async () => {
  const data = generate(12000, FROM, TO, 7);
  const api = new FakeLastfm(data);
  const r = await fetchAll(api);
  expectExact(r, data);
  assert.equal(r.verification.status, 'verified');
});

test('duplicatas idênticas no mesmo segundo são preservadas', async () => {
  const data = generate(900, FROM, TO, 3);
  const dupTs = FROM + 1000;
  for (let i = 0; i < 3; i++) data.push(makeTrack(dupTs, 'Dup', 'Same', 'X'));
  const api = new FakeLastfm(data);
  const r = await fetchAll(api);
  expectExact(r, data);
  assert.equal(r.scrobbles.filter((s) => s.track === 'Same').length, 3);
  assert.equal(new Set(r.scrobbles.map((s) => s.id)).size, r.scrobbles.length, 'ids únicos');
});

test('mais de 200 scrobbles no mesmo segundo (importação)', async () => {
  const data = generate(600, FROM, TO, 11);
  const burst = FROM + 7200;
  for (let i = 0; i < 530; i++) data.push(makeTrack(burst, `Imp ${i % 40}`, `T ${i}`, ''));
  const api = new FakeLastfm(data);
  const r = await fetchAll(api);
  expectExact(r, data);
  assert.equal(r.verification.status, 'verified');
});

test('scrobbles novos e retroativos inseridos durante a paginação não causam perdas', async () => {
  const data = generate(3000, FROM, TO, 5);
  const inserted = [];
  const api = new FakeLastfm(data, {
    onRequest: (fake, n) => {
      if (n === 3) {
        // novo scrobble "agora" (fora do intervalo) + retroativos dentro do intervalo
        const items = [makeTrack(TO + 500, 'Live', 'Now'), makeTrack(TO - 10, 'Offline', 'Recent'), makeTrack(FROM + 20, 'Offline', 'Old')];
        fake.data.push(...items);
        inserted.push(...items);
      }
    },
  });
  const r = await fetchAll(api);
  expectExact(r, [...data, ...inserted]);
  assert.equal(r.verification.status, 'verified');
  assert.equal(r.verification.changedDuringAudit, true);
});

test('"now playing" é ignorado', async () => {
  const data = generate(450, FROM, TO, 9);
  const api = new FakeLastfm(data, { nowPlaying: true });
  const r = await fetchAll(api);
  expectExact(r, data);
  assert.ok(!r.scrobbles.some((s) => s.track === 'Now'));
});

test('página vazia esporádica é retentada', async () => {
  const data = generate(1200, FROM, TO, 13);
  const api = new FakeLastfm(data);
  const orig = api.getRecentTracks.bind(api);
  let glitches = 0;
  api.getRecentTracks = async (args) => {
    const res = await orig(args);
    if (api.requests === 4 && glitches++ === 0) return { ...res, tracks: [] };
    return res;
  };
  const r = await fetchAll(api);
  expectExact(r, data);
});

test('intervalo inválido é rejeitado', () => {
  assert.throws(() => new RangeFetcher({ client: {}, user: 'u', from: TO, to: FROM }));
});

test('capa: usa a imagem média e ignora a estrela genérica da Last.fm', () => {
  const base = { name: 'T', artist: { '#text': 'A' }, album: { '#text': 'B' }, date: { uts: '100' } };
  const real = normalizeTrack({ ...base, image: [{ size: 'small', '#text': 'https://x/34s/capa.jpg' }, { size: 'medium', '#text': 'https://x/64s/capa.jpg' }] });
  assert.equal(real.image, 'https://x/64s/capa.jpg');
  const star = normalizeTrack({ ...base, image: [{ size: 'medium', '#text': 'https://x/64s/2a96cbd8b46e442fc41c2b86b821562f.png' }] });
  assert.equal(star.image, '');
  assert.equal(normalizeTrack(base).image, '');
});
