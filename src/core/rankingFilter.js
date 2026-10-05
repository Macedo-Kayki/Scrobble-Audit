import { normalizeText } from './filters.js';

/**
 * Filtro do ranking por artista, música e álbum.
 *
 * O ranking não guarda os scrobbles de cada usuário (seria pesado demais para o
 * localStorage). Guarda, em vez disso, quantas vezes cada combinação
 * artista + música + álbum aparece no período — o suficiente para responder
 * "quantos scrobbles de X cada pessoa fez" com qualquer combinação de filtros.
 */

export const EMPTY_RANKING_FILTER = Object.freeze({ artist: '', track: '', album: '', exact: false });

/** Contagem compacta: tabela de textos + linhas [artista, música, álbum, vezes]. */
export function encodeCombos(scrobbles) {
  const counts = new Map();
  for (const s of scrobbles) {
    const k = `${s.artist}\u0001${s.track}\u0001${s.album || ''}`;
    counts.set(k, (counts.get(k) || 0) + 1);
  }
  const strings = [];
  const index = new Map();
  const idx = (v) => {
    let i = index.get(v);
    if (i === undefined) {
      i = strings.length;
      strings.push(v);
      index.set(v, i);
    }
    return i;
  };
  const rows = [];
  for (const [k, n] of counts) {
    const [artist, track, album] = k.split('\u0001');
    rows.push([idx(artist), idx(track), idx(album), n]);
  }
  return { v: 1, strings, rows };
}

export function hasRankingFilter(f) {
  return Boolean(f && (String(f.artist || '').trim() || String(f.track || '').trim() || String(f.album || '').trim()));
}

/** Texto curto descrevendo o filtro: artista “X” · música “Y”. */
export function describeRankingFilter(f) {
  return [
    f.artist?.trim() && `artista “${f.artist.trim()}”`,
    f.track?.trim() && `música “${f.track.trim()}”`,
    f.album?.trim() && `álbum “${f.album.trim()}”`,
  ]
    .filter(Boolean)
    .join(' · ');
}

/**
 * Aplica o filtro a uma entrada do ranking.
 * @returns {{ total: number, uniqueTracks: number, uniqueArtists: number,
 *             topTrack: { artist: string, track: string, count: number } | null,
 *             topArtist: { artist: string, count: number } | null } | null}
 *          null quando a entrada não tem as contagens (auditada antes desta função existir).
 */
export function applyRankingFilter(entry, filter) {
  const combos = entry?.combos;
  if (!combos?.rows || !combos?.strings) return null;
  const exact = Boolean(filter.exact);
  const needles = {
    artist: normalizeText(filter.artist),
    track: normalizeText(filter.track),
    album: normalizeText(filter.album),
  };
  const match = (value, needle) => !needle || (exact ? normalizeText(value) === needle : normalizeText(value).includes(needle));
  const tracks = new Map();
  const artists = new Map();
  let total = 0;
  for (const [a, t, al, n] of combos.rows) {
    const artist = combos.strings[a];
    const track = combos.strings[t];
    const album = combos.strings[al];
    if (!match(artist, needles.artist) || !match(track, needles.track) || !match(album, needles.album)) continue;
    total += n;
    const tk = `${artist.toLowerCase()}\u0001${track.toLowerCase()}`;
    const te = tracks.get(tk) || { artist, track, count: 0 };
    te.count += n;
    tracks.set(tk, te);
    const ak = artist.toLowerCase();
    const ae = artists.get(ak) || { artist, count: 0 };
    ae.count += n;
    artists.set(ak, ae);
  }
  const top = (m) => [...m.values()].sort((x, y) => y.count - x.count)[0] || null;
  return { total, uniqueTracks: tracks.size, uniqueArtists: artists.size, topTrack: top(tracks), topArtist: top(artists) };
}
