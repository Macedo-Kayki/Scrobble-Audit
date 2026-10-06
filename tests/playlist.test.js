import { test } from 'node:test';
import assert from 'node:assert/strict';
import { analyzePlaylist, normalizeTitle, candidatePositions, buildPlaylistIndex } from '../src/core/playlist.js';
import { PLAYLIST } from '../src/data/playlist.js';

// Playlist pequena para os testes de ordem (5 faixas; nº 2 e nº 5 têm o mesmo título).
const P = {
  name: 'Teste',
  tracks: [
    { position: 1, title: 'Abertura', artists: ['Niink'], album: 'Disco A' },
    { position: 2, title: 'Interlúdio', artists: ['Niink'], album: 'Disco A' },
    { position: 3, title: 'Essência de Ri$co', artists: ['Niink', 'Supernova Ent'], album: 'Disco A' },
    { position: 4, title: 'Pirâmide (feat. Veigh)', artists: ['Supernova Ent', 'Niink', 'Veigh'], album: 'Mixtape' },
    { position: 5, title: 'Interlúdio', artists: ['Niink'], album: 'Disco B' },
  ],
};
let n = 0;
const S = (ts, track, artist = 'Niink', album = '') => ({ id: `s${++n}`, ts, track, artist, album });
const T0 = 1_000_000;
const run = (list) => analyzePlaylist(list, P);

test('normalização de títulos', () => {
  assert.equal(normalizeTitle('Esquema de Pirâmide (feat. Veigh)'), 'esquema de piramide');
  assert.equal(normalizeTitle('ESSÊNCIA DE RI$CO'), 'essencia de risco');
  assert.equal(normalizeTitle('Song - Remastered 2011'), 'song');
  assert.equal(normalizeTitle('LÍDERES (intro)'), 'lideres intro');
});

test('reconhece com nomes diferentes e exige o artista certo', () => {
  const idx = buildPlaylistIndex(P);
  assert.deepEqual(candidatePositions(S(T0, 'ESSENCIA DE RISCO', 'Niink'), idx).map((c) => c.position), [3]);
  assert.deepEqual(candidatePositions(S(T0, 'Pirâmide', 'Supernova Ent'), idx).map((c) => c.position), [4]);
  assert.deepEqual(candidatePositions(S(T0, 'Abertura', 'Outra Banda'), idx), [], 'mesmo título, outro artista');
});

test('toda a playlist na ordem, inclusive voltando ao início', () => {
  const list = [1, 2, 3, 4, 5, 1, 2].map((p, i) => S(T0 + i * 180, P.tracks[p - 1].title.replace(' (feat. Veigh)', ''), 'Niink', P.tracks[p - 1].album));
  const r = run(list);
  assert.equal(r.counts.total, 0);
  assert.equal(r.stats.transitions, 6);
  assert.equal(r.stats.inOrder, 6);
  assert.deepEqual([...r.positionById.values()], [1, 2, 3, 4, 5, 1, 2], 'os dois Interlúdios são desempatados');
});

test('pulou, voltou e repetiu', () => {
  const r = run([S(T0, 'Abertura'), S(T0 + 180, 'Essência de Ri$co'), S(T0 + 360, 'Abertura'), S(T0 + 540, 'Abertura')]);
  assert.deepEqual([r.counts.skip, r.counts.back, r.counts.repeat, r.counts.outside], [1, 1, 1, 0]);
  const skip = r.events.find((e) => e.type === 'skip');
  assert.equal(skip.from.pos, 1);
  assert.equal(skip.to.pos, 3);
  assert.equal(skip.skipped, 1);
  assert.equal(skip.expected.pos, 2);
});

test('música de fora no meio conta uma vez por interrupção', () => {
  const r = run([S(T0, 'Abertura'), S(T0 + 180, 'Outra', 'Outra Banda'), S(T0 + 360, 'Mais outra', 'X'), S(T0 + 540, 'Interlúdio', 'Niink', 'Disco A')]);
  assert.equal(r.counts.outside, 1);
  assert.equal(r.counts.total, 1, 'voltou na sequência certa depois da interrupção');
  assert.equal(r.events[0].outside.length, 2);
});

test('pausa longa começa uma sessão nova e não conta como saída', () => {
  const r = run([S(T0, 'Abertura'), S(T0 + 3 * 3600, 'Essência de Ri$co'), S(T0 + 3 * 3600 + 100, 'Fora', 'X')]);
  assert.equal(r.counts.total, 0);
  assert.equal(r.stats.sessions, 2);
});

test('músicas de fora antes ou depois da playlist não contam', () => {
  const r = run([S(T0, 'Fora', 'X'), S(T0 + 100, 'Abertura'), S(T0 + 200, 'Interlúdio', 'Niink', 'Disco A'), S(T0 + 300, 'Fora 2', 'Y')]);
  assert.equal(r.counts.total, 0);
});

test('a playlist embutida tem as 32 músicas do arquivo, sem dados pessoais', () => {
  assert.equal(PLAYLIST.tracks.length, 32);
  assert.equal(PLAYLIST.tracks[0].title, 'LÍDERES (intro)');
  assert.ok(PLAYLIST.tracks.every((t) => !('addedBy' in t)));
  const idx = buildPlaylistIndex(PLAYLIST);
  assert.equal(idx.byTitle.get('interludio').length, 2);
});

/* ---------- Regras da playlist real ---------- */

const T0R = Math.floor(Date.parse('2026-10-03T15:00:00-03:00') / 1000);
const real = (pos, ts) => {
  const t = PLAYLIST.tracks[pos - 1];
  return { id: `r${pos}-${ts}`, ts, track: t.title, artist: t.artists[0], album: t.album };
};
const seq = (positions) => positions.map((p, i) => real(p, T0R + i * 150));

test('"VC NÃO PARECE MAIS A MESMA" é sempre a nº 19, em qualquer data', () => {
  for (const day of ['2026-10-01T12:00:00-03:00', '2026-10-05T12:00:00-03:00']) {
    const ts = Math.floor(Date.parse(day) / 1000);
    const r = analyzePlaylist([real(18, ts), real(19, ts + 150), real(20, ts + 300)], PLAYLIST);
    assert.equal(r.positionById.get(`r19-${ts + 150}`), 19);
    assert.equal(r.counts.total, 0);
  }
  assert.equal(PLAYLIST.versions, undefined, 'sem mudança de ordem registrada');
});

test('sair da nº 19 para qualquer outra não conta como pulo', () => {
  for (const next of [25, 3, 1, 32]) {
    const r = analyzePlaylist(seq([18, 19, next]), PLAYLIST);
    assert.equal(r.counts.total, 0, `19 → ${next}`);
    assert.equal(r.stats.inOrder, r.stats.transitions);
  }
});

test('entrar na nº 19 pulando não conta como pulo', () => {
  for (const from of [10, 18, 20, 32]) {
    const r = analyzePlaylist(seq([from, 19]), PLAYLIST);
    assert.equal(r.counts.total, 0, `${from} → 19`);
    assert.equal(r.stats.inOrder, r.stats.transitions);
  }
  const r2 = analyzePlaylist(seq([10, 19, 19]), PLAYLIST);
  assert.equal(r2.counts.repeat, 1, '19 → 19 repetiu');
  assert.equal(r2.counts.skip, 0, '10 → 19 não é pulo');
});

test('voltar da nº 31 para a nº 1 é normal; da nº 30 para a nº 1, não', () => {
  const r1 = analyzePlaylist(seq([30, 31, 1]), PLAYLIST);
  assert.equal(r1.counts.total, 0);
  const r2 = analyzePlaylist(seq([29, 30, 1]), PLAYLIST);
  assert.equal(r2.counts.back, 1);
});

test('ir do Interlúdio nº 32 para a nº 19 não conta; do INTERLÚDIO nº 12 para a nº 19, conta', () => {
  const r1 = analyzePlaylist(seq([31, 32, 19]), PLAYLIST);
  assert.equal(r1.counts.total, 0);
  assert.equal(r1.positionById.get(`r32-${T0R + 150}`), 32, 'reconheceu o Interlúdio do fim');
  const r2 = analyzePlaylist(seq([11, 12, 19]), PLAYLIST);
  assert.equal(r2.counts.skip, 1);
});
