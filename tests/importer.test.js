import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseImport, parseCSV } from '../src/core/importer.js';
import { auditToJSON, toCSV, scrobbleToRecord, rankingToRecords } from '../src/core/export.js';
import { computeStats } from '../src/core/stats.js';
import { annotateGaps } from '../src/core/model.js';
import { summarize, rankingRows } from '../src/ui/app.js';

const TZ = 'America/Sao_Paulo';
const FROM = 1_791_198_000; // 05/10/2026 08:00 (São Paulo)
const TO = FROM + 5 * 3600;

const S = (ts, artist, track, album = '', extra = {}) => ({ id: `${ts}-${track}`, source: 'lastfm', ts, artist, track, album, artistMbid: '', trackMbid: '', albumMbid: '', url: '', image: '', ...extra });
const scrobbles = annotateGaps([
  S(FROM + 4000, 'Björk', 'Jóga', 'Homogenic', { url: 'https://www.last.fm/music/Bj%C3%B6rk/_/J%C3%B3ga' }),
  S(FROM + 3000, 'Sepultura', '=Roots, Bloody "Roots"', 'Roots'), // vírgula, aspas e prefixo de fórmula
  S(FROM + 3000, 'Sepultura', '=Roots, Bloody "Roots"', 'Roots'), // duplicata legítima (mesmo segundo)
  S(FROM + 10, 'Radiohead', 'Karma Police', 'OK Computer', { trackMbid: 'abc-123' }),
  S(FROM, 'Caetano Veloso', 'Sozinho'),
]);
const audit = {
  source: 'lastfm',
  sourceName: 'Last.fm',
  username: 'Tester',
  range: { from: FROM, to: TO, requestedTo: TO, timeZone: TZ, inclusiveEnd: true },
  scrobbles,
  verification: { status: 'verified', expected: 5, fetchedInWindow: 5 },
  requests: 3,
  finishedAt: Date.UTC(2026, 9, 5, 16, 0),
};
const durations = new Map([['radiohead\u0001karma police', 263000]]);
const opts = { fileName: 'x', fallbackTimeZone: 'UTC' };

const comparable = (list) => list.map(({ ts, artist, track, album, trackMbid, url }) => ({ ts, artist, track, album, trackMbid, url }));

test('JSON de auditoria: ida e volta sem perdas', () => {
  const json = auditToJSON({ audit, scrobbles, filters: {}, stats: computeStats(scrobbles, { timeZone: TZ }), timeZone: TZ, durations, scope: 'all' });
  const r = parseImport(json, { ...opts, fileName: 'auditoria.json' });
  assert.equal(r.kind, 'audit');
  assert.deepEqual(comparable(r.audit.scrobbles), comparable(scrobbles));
  assert.equal(r.audit.username, 'Tester');
  assert.equal(r.audit.range.from, FROM);
  assert.equal(r.audit.range.to, TO);
  assert.equal(r.audit.range.timeZone, TZ);
  assert.equal(r.audit.range.startInput, '2026-10-05T08:00:00');
  assert.equal(r.audit.verification.status, 'imported');
  assert.equal(r.audit.verification.original.status, 'verified');
  assert.equal(r.audit.imported.rangeDerived, false);
  assert.equal(r.durations.get('radiohead\u0001karma police'), 263000);
  assert.equal(new Set(r.audit.scrobbles.map((s) => s.id)).size, 5, 'ids únicos, duplicata preservada');
  assert.deepEqual(r.warnings, []);
});

test('JSON filtrado avisa que é um subconjunto', () => {
  const json = auditToJSON({ audit, scrobbles: scrobbles.slice(0, 2), filters: { artist: 'x' }, stats: null, timeZone: TZ, durations, scope: 'filtered' });
  const r = parseImport(json, opts);
  assert.equal(r.audit.imported.scope, 'filtered');
  assert.deepEqual(r.audit.imported.filters, { artist: 'x' });
  assert.ok(r.warnings.some((w) => /filtrado/.test(w)));
});

for (const delimiter of [',', ';', '\t']) {
  test(`CSV de auditoria (separador ${JSON.stringify(delimiter)}): ida e volta, desfazendo a proteção de fórmulas`, () => {
    const records = scrobbles.map((s) => scrobbleToRecord(s, { timeZone: TZ, username: 'Tester', durations }));
    const r = parseImport(toCSV(records, { delimiter }), opts);
    assert.equal(r.kind, 'audit');
    assert.deepEqual(comparable(r.audit.scrobbles), comparable(scrobbles));
    assert.equal(r.audit.scrobbles.filter((s) => s.track === '=Roots, Bloody "Roots"').length, 2);
    assert.equal(r.audit.range.timeZone, TZ);
    assert.equal(r.audit.imported.rangeDerived, true, 'CSV não traz o intervalo');
    assert.equal(r.audit.range.from, FROM);
    assert.equal(r.audit.range.to, FROM + 4000);
  });
}

test('lista de horários de uma música (JSON array) também importa', () => {
  const records = scrobbles.slice(1, 3).map((s) => scrobbleToRecord(s, { timeZone: TZ, username: 'Tester' }));
  const r = parseImport(JSON.stringify(records), opts);
  assert.equal(r.audit.scrobbles.length, 2);
});

test('linhas inválidas são ignoradas e contadas', () => {
  const r = parseImport(JSON.stringify([{ timestamp_unix: FROM, artist: 'A', track: 'T' }, { artist: 'sem ts', track: 'x' }, { timestamp_unix: FROM, artist: '', track: 'x' }, null]), opts);
  assert.equal(r.audit.scrobbles.length, 1);
  assert.equal(r.skipped, 3);
});

test('ranking JSON (com entries completas) e CSV', () => {
  const range = { from: FROM, to: TO, requestedTo: TO, timeZone: TZ, inclusiveEnd: true, startInput: '2026-10-05T08:00:00', endInput: '2026-10-05T13:00:00' };
  const entries = [summarize({ ...audit, finishedAt: 1 }), summarize({ ...audit, username: 'Outro', scrobbles: scrobbles.slice(0, 2), finishedAt: 2 })];
  const ranking = { range, entries };
  const records = rankingToRecords(rankingRows(ranking).current, ranking);

  const json = JSON.stringify({ kind: 'scrobble-audit/ranking', range, ranking: records, entries: rankingRows(ranking).current });
  const rj = parseImport(json, opts);
  assert.equal(rj.kind, 'ranking');
  assert.deepEqual(rj.ranking.entries, rankingRows(ranking).current);
  assert.equal(rankingRows(rj.ranking).current.length, 2, 'entradas casam com o intervalo');

  const rc = parseImport(toCSV(records, { delimiter: ';' }), opts);
  assert.equal(rc.kind, 'ranking');
  assert.equal(rc.ranking.range.from, FROM);
  assert.equal(rc.ranking.range.to, TO);
  const tester = rc.ranking.entries.find((e) => e.username === 'Tester');
  assert.equal(tester.total, 5);
  assert.equal(tester.topTrack.track, '=Roots, Bloody "Roots"');
  assert.equal(tester.topTrack.artist, 'Sepultura');
  assert.equal(rankingRows(rc.ranking).current.length, 2);
});

test('arquivos inválidos geram erro claro', () => {
  assert.throws(() => parseImport('', opts), /vazio/);
  assert.throws(() => parseImport('{ quebrado', opts), /corrompido/);
  assert.throws(() => parseImport('{"foo":1}', opts), /não reconhecido/);
  assert.throws(() => parseImport('a,b\n1,2', opts), /não reconhecida/);
  assert.throws(() => parseImport('[]', opts), /nenhum scrobble/i);
});

test('parser CSV: aspas, quebras de linha e CRLF', () => {
  assert.deepEqual(parseCSV('a,b\r\n"x, ""y""","linha\nnova"\r\n'), [['a', 'b'], ['x, "y"', 'linha\nnova']]);
});
