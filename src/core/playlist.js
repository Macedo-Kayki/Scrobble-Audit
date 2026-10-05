import { normalizeText } from './filters.js';

/**
 * Reconhecimento das músicas de uma playlist nos scrobbles e análise de ordem.
 *
 * RECONHECIMENTO
 * Os nomes no Spotify e na Last.fm nem sempre são idênticos ("(feat. X)",
 * "- Remastered", acentos, "$" no lugar de "S"). Comparamos o título
 * normalizado e exigimos que o artista do scrobble seja um dos artistas da
 * faixa — para não confundir, por exemplo, "ARENA" com outra música "Arena".
 * Títulos repetidos na playlist (dois "Interlúdio") são desempatados pela
 * posição esperada na sequência e, depois, pelo álbum.
 *
 * ORDEM (scrobbles do mais antigo para o mais recente)
 * - Sessão: mais de `sessionGapSec` sem scrobbles começa uma sessão nova;
 *   parar de ouvir não conta como sair da ordem.
 * - Entre duas músicas da playlist na mesma sessão (posições p → q):
 *     q = p + 1 (ou 1 depois da última) .... na ordem
 *     q = p ................................ repeat  (repetiu)
 *     q > p + 1 (ou >1 depois da última) ... skip    (pulou)
 *     q < p ................................ back    (voltou)
 * - Músicas de fora da playlist entre duas da playlist na mesma sessão
 *   contam como "outside" (tocou outra no meio), uma vez por interrupção.
 */

export const EVENT_TYPES = ['skip', 'back', 'repeat', 'outside'];
export const SESSION_GAP_SEC = 30 * 60;

/** Título comparável: sem acentos, sem "(feat. …)", sem "- Remastered …". */
export function normalizeTitle(title) {
  return normalizeText(title)
    .replace(/[([](?:feat|ft|with|part|participacao|prod)\.?[^)\]]*[)\]]/g, ' ')
    .replace(/\s+-\s+.*(?:remaster|version|versao|ao vivo|live|edit|mix).*$/g, ' ')
    .replace(/\$/g, 's')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function normalizeName(name) {
  return normalizeText(name).replace(/[^a-z0-9]+/g, ' ').trim();
}

/** Índice da playlist por título normalizado. */
export function buildPlaylistIndex(playlist) {
  const byTitle = new Map();
  for (const t of playlist.tracks) {
    const key = normalizeTitle(t.title);
    const entry = { ...t, key, artistKeys: t.artists.map(normalizeName).filter(Boolean), albumKey: normalizeName(t.album) };
    if (!byTitle.has(key)) byTitle.set(key, []);
    byTitle.get(key).push(entry);
  }
  return { size: playlist.tracks.length, byTitle, tracks: playlist.tracks };
}

/** Posições da playlist que podem corresponder a este scrobble (vazio = fora da playlist). */
export function candidatePositions(scrobble, index) {
  const list = index.byTitle.get(normalizeTitle(scrobble.track));
  if (!list) return [];
  const artist = normalizeName(scrobble.artist);
  return list.filter((t) => t.artistKeys.some((a) => a && (artist.includes(a) || a.includes(artist))));
}

function resolvePosition(scrobble, candidates, expected) {
  if (candidates.length === 1) return candidates[0].position;
  if (expected && candidates.some((c) => c.position === expected)) return expected;
  const album = normalizeName(scrobble.album);
  const byAlbum = album && candidates.find((c) => c.albumKey === album);
  return (byAlbum || candidates[0]).position;
}

/**
 * Analisa a ordem da playlist nos scrobbles.
 * @param {import('./model.js').Scrobble[]} scrobbles qualquer ordem
 * @returns {{ positionById: Map<string, number>, events: object[], counts: Record<string, number>, stats: object }}
 */
export function analyzePlaylist(scrobbles, playlist, { sessionGapSec = SESSION_GAP_SEC } = {}) {
  const index = buildPlaylistIndex(playlist);
  const N = index.size;
  const asc = [...scrobbles].sort((a, b) => a.ts - b.ts || (a.id < b.id ? -1 : 1));
  const positionById = new Map();
  const events = [];
  const counts = { skip: 0, back: 0, repeat: 0, outside: 0 };
  const heard = new Set();
  let transitions = 0;
  let inOrder = 0;
  let sessions = 0;

  let prev = null; // último scrobble da playlist na sessão atual: { s, pos }
  let outsideRun = []; // músicas de fora desde `prev`
  let lastTs = null;
  let sessionHasPlaylist = false;

  for (const s of asc) {
    if (lastTs != null && s.ts - lastTs > sessionGapSec) {
      prev = null;
      outsideRun = [];
      sessionHasPlaylist = false;
    }
    lastTs = s.ts;

    const cands = candidatePositions(s, index);
    if (!cands.length) {
      if (prev) outsideRun.push(s);
      continue;
    }
    const expected = prev ? (prev.pos === N ? 1 : prev.pos + 1) : null;
    const pos = resolvePosition(s, cands, expected);
    positionById.set(s.id, pos);
    heard.add(pos);
    if (!sessionHasPlaylist) {
      sessions++;
      sessionHasPlaylist = true;
    }

    if (prev) {
      if (outsideRun.length) {
        counts.outside++;
        events.push(makeEvent('outside', prev, { s, pos }, expected, index, { outside: outsideRun }));
      }
      transitions++;
      if (pos === expected) inOrder++;
      else {
        const type = pos === prev.pos ? 'repeat' : prev.pos === N || pos > prev.pos ? 'skip' : 'back';
        counts[type]++;
        const skipped = type === 'skip' ? (prev.pos === N ? pos - 1 : pos - prev.pos - 1) : 0;
        events.push(makeEvent(type, prev, { s, pos }, expected, index, { skipped }));
      }
    }
    prev = { s, pos };
    outsideRun = [];
  }

  events.sort((a, b) => a.ts - b.ts);
  const total = counts.skip + counts.back + counts.repeat + counts.outside;
  return {
    positionById,
    events,
    counts: { ...counts, total },
    stats: {
      playlistScrobbles: positionById.size,
      sessions,
      transitions,
      inOrder,
      notHeard: index.tracks.filter((t) => !heard.has(t.position)),
    },
  };
}

/** Frase simples descrevendo uma saída da ordem. */
export function describePlaylistEvent(e) {
  const t = (x) => `nº ${x.pos} “${x.title}”`;
  if (e.type === 'skip') return `Pulou de ${t(e.from)} para ${t(e.to)} (pulou ${e.skipped} música${e.skipped === 1 ? '' : 's'})`;
  if (e.type === 'back') return `Voltou de ${t(e.from)} para ${t(e.to)}`;
  if (e.type === 'repeat') return `Repetiu ${t(e.to)}`;
  return `Tocou ${e.outside.length} música${e.outside.length === 1 ? '' : 's'} de fora da playlist entre ${t(e.from)} e ${t(e.to)}`;
}

function makeEvent(type, from, to, expected, index, extra) {
  const track = (pos) => index.tracks[pos - 1];
  return {
    type,
    id: `${type}:${to.s.id}`,
    ts: to.s.ts,
    scrobbleId: to.s.id,
    fromId: from.s.id,
    from: { pos: from.pos, title: track(from.pos).title },
    to: { pos: to.pos, title: track(to.pos).title },
    expected: expected ? { pos: expected, title: track(expected).title } : null,
    skipped: extra.skipped || 0,
    outside: (extra.outside || []).map((o) => ({ id: o.id, ts: o.ts, artist: o.artist, track: o.track })),
  };
}
