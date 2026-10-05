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

/* ---------- Mudança de ordem em 02/10/2026 10:00 (horário de Brasília) ---------- */

const CHANGE = Math.floor(Date.parse('2026-10-02T10:00:00-03:00') / 1000);
const real = (pos, ts) => {
  const t = PLAYLIST.tracks[pos - 1];
  return { id: `r${pos}-${ts}`, ts, track: t.title, artist: t.artists[0], album: t.album };
};

test('antes da mudança: "VC NÃO PARECE MAIS A MESMA" era a última', () => {
  const t0 = CHANGE - 4 * 3600;
  // 17 → 18 → 20 → 21 … 32 → 19 → 1 (a ordem antiga, sem a 19 no meio)
  const seq = [17, 18, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31, 32, 19, 1];
  const r = analyzePlaylist(seq.map((p, i) => real(p, t0 + i * 150)), PLAYLIST);
  assert.equal(r.counts.total, 0, 'seguiu a ordem antiga');
  assert.equal(r.positionById.get(`r19-${t0 + 15 * 150}`), 32, 'era a nº 32');
  assert.equal(r.positionById.get(`r20-${t0 + 2 * 150}`), 19, 'a NÃO FAZEMOS POP era a nº 19');
  assert.equal(r.changes.length, 1);
});

test('depois da mudança: vale a ordem atual', () => {
  const t0 = CHANGE + 3600;
  const inOrder = analyzePlaylist([18, 19, 20].map((p, i) => real(p, t0 + i * 150)), PLAYLIST);
  assert.equal(inOrder.counts.total, 0);
  assert.equal(inOrder.positionById.get(`r19-${t0 + 150}`), 19);
  const oldOrder = analyzePlaylist([18, 20].map((p, i) => real(p, t0 + i * 150)), PLAYLIST);
  assert.equal(oldOrder.counts.skip, 1, 'pular a 19 agora é sair da ordem');
  assert.equal(oldOrder.events[0].expected.title, PLAYLIST.tracks[18].title);
});

test('o instante da mudança vale para a ordem nova', () => {
  const r = analyzePlaylist([real(18, CHANGE - 150), real(19, CHANGE)], PLAYLIST);
  assert.equal(r.counts.total, 0, '18 → 19 às 10:00 já está na ordem nova');
});

test('voltar da nº 31 para a nº 1 é normal (antes e depois da mudança)', () => {
  const after = CHANGE + 3600;
  const r1 = analyzePlaylist([real(30, after), real(31, after + 150), real(1, after + 300)], PLAYLIST);
  assert.equal(r1.counts.total, 0, '31 → 1 depois da mudança');
  assert.equal(r1.stats.inOrder, 2);
  // Antes da mudança, a nº 31 era o "Interlúdio" (faixa 32 de hoje).
  const before = CHANGE - 4 * 3600;
  const r2 = analyzePlaylist([real(31, before), real(32, before + 150), real(1, before + 300)], PLAYLIST);
  assert.equal(r2.positionById.get(`r32-${before + 150}`), 31);
  assert.equal(r2.counts.total, 0, '31 → 1 antes da mudança');
  // Outras voltas para o início continuam contando.
  const r3 = analyzePlaylist([real(29, after), real(30, after + 150), real(1, after + 300)], PLAYLIST);
  assert.equal(r3.counts.back, 1, '30 → 1 ainda é voltar');
});
