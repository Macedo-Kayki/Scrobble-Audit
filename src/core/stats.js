import { trackKey, artistKey, albumKey } from './model.js';
import { localParts } from './time.js';
import { AUDIT } from '../config.js';

const pad = (n) => String(n).padStart(2, '0');

/**
 * Estatísticas de um conjunto de scrobbles.
 * @param {import('./model.js').Scrobble[]} scrobbles
 * @param {{ timeZone: string, range?: { from: number, to: number } }} ctx
 */
export function computeStats(scrobbles, { timeZone, range }) {
  const tracks = new Map();
  const artists = new Map();
  const albums = new Map();
  const byHour = new Array(24).fill(0);
  const byWeekday = new Array(7).fill(0);
  let first = null;
  let last = null;
  let shortGaps = 0;

  for (const s of scrobbles) {
    bump(tracks, trackKey(s), () => ({ artist: s.artist, track: s.track }));
    bump(artists, artistKey(s), () => ({ artist: s.artist }));
    const ak = albumKey(s);
    if (ak) bump(albums, ak, () => ({ artist: s.artist, album: s.album }));
    const p = localParts(s.ts, timeZone);
    byHour[p.hour]++;
    byWeekday[p.weekday]++;
    if (first == null || s.ts < first) first = s.ts;
    if (last == null || s.ts > last) last = s.ts;
    if (s.gapPrev != null && s.gapPrev < AUDIT.shortGapSeconds) shortGaps++;
  }

  const top = (m, n = 10) => [...m.values()].sort((a, b) => b.count - a.count || (a.artist + (a.track || a.album || '')).localeCompare(b.artist + (b.track || b.album || ''))).slice(0, n);
  const topTracks = top(tracks);
  const topArtists = top(artists);
  const topAlbums = top(albums);

  const spanFrom = range?.from ?? first;
  const spanTo = range?.to ?? last;
  const spanDays = spanFrom != null && spanTo != null ? Math.max((spanTo - spanFrom + 1) / 86400, 1 / 24) : null;

  return {
    total: scrobbles.length,
    uniqueTracks: tracks.size,
    uniqueArtists: artists.size,
    uniqueAlbums: albums.size,
    topTracks,
    topArtists,
    topAlbums,
    topTrackTies: topTracks.length ? [...tracks.values()].filter((t) => t.count === topTracks[0].count).length : 0,
    topArtistTies: topArtists.length ? [...artists.values()].filter((t) => t.count === topArtists[0].count).length : 0,
    first,
    last,
    byHour,
    byWeekday,
    shortGaps,
    perDay: spanDays ? scrobbles.length / spanDays : null,
    timeline: range ? buildTimeline(scrobbles, range, timeZone) : null,
  };
}

function bump(map, key, init) {
  let e = map.get(key);
  if (!e) {
    e = { ...init(), count: 0 };
    map.set(key, e);
  }
  e.count++;
}

/**
 * Série temporal com todos os buckets do intervalo (inclusive zeros).
 * Unidade escolhida pelo tamanho do intervalo: hora (≤ 3 dias), dia (≤ 120 dias), mês.
 */
export function buildTimeline(scrobbles, range, timeZone) {
  const spanSec = range.to - range.from;
  const unit = spanSec <= 3 * 86400 ? 'hour' : spanSec <= 120 * 86400 ? 'day' : 'month';
  const keyOf = (p) =>
    unit === 'hour' ? `${p.year}-${pad(p.month)}-${pad(p.day)}T${pad(p.hour)}` : unit === 'day' ? `${p.year}-${pad(p.month)}-${pad(p.day)}` : `${p.year}-${pad(p.month)}`;

  // Gera as chaves andando em "wall time" (aritmética UTC sobre componentes locais).
  const a = localParts(range.from, timeZone);
  const b = localParts(range.to, timeZone);
  const cursor = new Date(Date.UTC(a.year, a.month - 1, unit === 'month' ? 1 : a.day, unit === 'hour' ? a.hour : 0));
  const end = Date.UTC(b.year, b.month - 1, unit === 'month' ? 1 : b.day, unit === 'hour' ? b.hour : 0);
  const buckets = [];
  const index = new Map();
  while (cursor.getTime() <= end && buckets.length < 5000) {
    const p = { year: cursor.getUTCFullYear(), month: cursor.getUTCMonth() + 1, day: cursor.getUTCDate(), hour: cursor.getUTCHours() };
    const key = keyOf(p);
    // `label` curto para o eixo; `fullLabel` completo para tooltip.
    const label = unit === 'hour' ? `${pad(p.hour)}h` : unit === 'day' ? `${pad(p.day)}/${pad(p.month)}` : `${pad(p.month)}/${p.year}`;
    const fullLabel = unit === 'hour' ? `${pad(p.day)}/${pad(p.month)}/${p.year} ${pad(p.hour)}h` : unit === 'day' ? `${pad(p.day)}/${pad(p.month)}/${p.year}` : `${pad(p.month)}/${p.year}`;
    index.set(key, buckets.length);
    buckets.push({ key, label, fullLabel, count: 0 });
    if (unit === 'hour') cursor.setUTCHours(cursor.getUTCHours() + 1);
    else if (unit === 'day') cursor.setUTCDate(cursor.getUTCDate() + 1);
    else cursor.setUTCMonth(cursor.getUTCMonth() + 1);
  }
  for (const s of scrobbles) {
    const i = index.get(keyOf(localParts(s.ts, timeZone)));
    if (i !== undefined) buckets[i].count++;
  }
  return { unit, buckets };
}
