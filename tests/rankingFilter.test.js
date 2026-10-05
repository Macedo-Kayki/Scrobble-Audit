import { test } from 'node:test';
import assert from 'node:assert/strict';
import { encodeCombos, applyRankingFilter, hasRankingFilter, describeRankingFilter } from '../src/core/rankingFilter.js';
import { summarize } from '../src/ui/app.js';

const S = (ts, artist, track, album = '') => ({ id: String(ts), source: 'lastfm', ts, artist, track, album });
const scrobbles = [
  S(1, 'Björk', 'Jóga', 'Homogenic'),
  S(2, 'Björk', 'Jóga', 'Homogenic'),
  S(3, 'Björk', 'Hyperballad', 'Post'),
  S(4, 'Radiohead', 'Creep', 'Pablo Honey'),
  S(5, 'Radiohead', 'Creep', ''), // mesmo par artista+música, sem álbum
  S(6, 'Bjork Tribute Band', 'Joga (cover)', 'Covers'),
];
const entry = { username: 'x', total: scrobbles.length, combos: encodeCombos(scrobbles) };

test('filtro por artista, música e álbum (contém, sem acento)', () => {
  assert.equal(applyRankingFilter(entry, { artist: 'bjork' }).total, 4); // inclui a banda tributo
  assert.equal(applyRankingFilter(entry, { artist: 'bjork', exact: true }).total, 3);
  assert.equal(applyRankingFilter(entry, { track: 'joga' }).total, 3);
  assert.equal(applyRankingFilter(entry, { track: 'jóga', exact: true }).total, 2);
  assert.equal(applyRankingFilter(entry, { album: 'homogenic' }).total, 2);
  assert.equal(applyRankingFilter(entry, { artist: 'radiohead', track: 'creep' }).total, 2);
  assert.equal(applyRankingFilter(entry, { artist: 'radiohead', album: 'pablo' }).total, 1);
  assert.equal(applyRankingFilter(entry, { artist: 'ninguém' }).total, 0);
});

test('resumo do filtro: músicas diferentes e mais ouvida', () => {
  const v = applyRankingFilter(entry, { artist: 'björk', exact: true });
  assert.equal(v.uniqueTracks, 2);
  assert.equal(v.topTrack.track, 'Jóga');
  assert.equal(v.topTrack.count, 2);
});

test('entradas antigas, sem contagens, não podem ser filtradas', () => {
  assert.equal(applyRankingFilter({ username: 'antigo', total: 10 }, { artist: 'x' }), null);
});

test('summarize guarda as contagens e elas somam o total', () => {
  const e = summarize({ username: 'u', source: 'lastfm', scrobbles, range: { from: 0, to: 10, timeZone: 'America/Sao_Paulo' }, verification: { status: 'verified' }, finishedAt: 1 });
  assert.equal(applyRankingFilter(e, { artist: '' , track: '', album: '' }).total, scrobbles.length);
  assert.equal(JSON.parse(JSON.stringify(e)).combos.rows.length, e.combos.rows.length, 'serializável');
});

test('descrição e detecção do filtro', () => {
  assert.equal(hasRankingFilter({ artist: '  ' }), false);
  assert.equal(hasRankingFilter({ album: 'x' }), true);
  assert.equal(describeRankingFilter({ artist: 'Björk', track: 'Jóga' }), 'artista “Björk” · música “Jóga”');
});
