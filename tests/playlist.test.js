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
