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
 * - `alsoInOrder` (src/data/playlist.js): passagens extras consideradas normais,
 *   pelo número da posição (ex.: da nº 31 para a nº 1).
 * - `noSkipFrom`: sair destas faixas para qualquer outra não conta como pulou/voltou.
 * - A ordem pode mudar com o tempo (`versions` em src/data/playlist.js): cada
 *   passagem é avaliada na ordem que valia no momento da música que chegou.
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

/** Escolhe a faixa (número atual) entre candidatas de mesmo título: a esperada, depois pelo álbum. */
function resolveTrack(scrobble, candidates, expectedTrack) {
  if (candidates.length === 1) return candidates[0].position;
  if (expectedTrack && candidates.some((c) => c.position === expectedTrack)) return expectedTrack;
  const album = normalizeName(scrobble.album);
  const byAlbum = album && candidates.find((c) => c.albumKey === album);
  return (byAlbum || candidates[0]).position;
}

/**
 * Versões da ordem da playlist no tempo. Cada uma lista as faixas (pelo número
 * atual) na ordem que valia a partir de `from`. Sem `versions`, vale a ordem atual.
 */
export function buildVersions(playlist) {
  const raw = playlist.versions?.length ? playlist.versions : [{ from: null, order: playlist.tracks.map((t) => t.position) }];
  return raw
    .map((v) => ({
      fromTs: v.from ? Math.floor(Date.parse(v.from) / 1000) : -Infinity,
      from: v.from || null,
      note: v.note || '',
      order: v.order,
      posOf: new Map(v.order.map((track, i) => [track, i + 1])),
    }))
    .sort((a, b) => a.fromTs - b.fromTs);
}

function versionAt(versions, ts) {
  let v = versions[0];
  for (const x of versions) if (x.fromTs <= ts) v = x;
  return v;
}

/** Próxima faixa depois de `track` na versão (a última volta para a primeira). */
function nextTrack(version, track) {
  const pos = version.posOf.get(track);
  if (!pos) return null;
  return version.order[pos % version.order.length];
}

/**
 * Analisa a ordem da playlist nos scrobbles, usando a ordem que valia no
 * momento de cada scrobble (veja `versions` em src/data/playlist.js).
 * @param {import('./model.js').Scrobble[]} scrobbles qualquer ordem
 * @returns {{ positionById: Map<string, number>, events: object[], counts: Record<string, number>, stats: object, changes: object[] }}
 *   positionById: posição do scrobble na ordem que valia naquele momento.
 */
export function analyzePlaylist(scrobbles, playlist, { sessionGapSec = SESSION_GAP_SEC } = {}) {
  const index = buildPlaylistIndex(playlist);
  const versions = buildVersions(playlist);
  const alsoInOrder = new Set((playlist.alsoInOrder || []).map((r) => `${r.from}>${r.to}`));
  const noSkipFrom = new Set((playlist.noSkipFrom || []).map((r) => r.track));
  const asc = [...scrobbles].sort((a, b) => a.ts - b.ts || (a.id < b.id ? -1 : 1));
  const positionById = new Map();
  const events = [];
  const counts = { skip: 0, back: 0, repeat: 0, outside: 0 };
  const heard = new Set();
  let transitions = 0;
  let inOrder = 0;
  let sessions = 0;

  let prev = null; // última faixa da playlist na sessão atual: { s, track }
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

    const v = versionAt(versions, s.ts);
    const cands = candidatePositions(s, index).filter((c) => v.posOf.has(c.position));
    if (!cands.length) {
      if (prev) outsideRun.push(s);
      continue;
    }
    const expectedTrack = prev ? nextTrack(v, prev.track) : null;
    const track = resolveTrack(s, cands, expectedTrack);
    const pos = v.posOf.get(track);
    positionById.set(s.id, pos);
    heard.add(track);
    if (!sessionHasPlaylist) {
      sessions++;
      sessionHasPlaylist = true;
    }

    // A passagem é avaliada na ordem que valia no momento da música que chegou.
    const prevPos = prev ? v.posOf.get(prev.track) : null;
    if (prev && prevPos) {
      const N = v.order.length;
      const ctx = { v, index };
      const from = { s: prev.s, track: prev.track, pos: prevPos };
      const to = { s, track, pos };
      if (outsideRun.length) {
        counts.outside++;
        events.push(makeEvent('outside', from, to, expectedTrack, ctx, { outside: outsideRun }));
      }
      transitions++;
      const freeExit = noSkipFrom.has(prev.track) && track !== prev.track; // pulo a partir dela não conta
      if (track === expectedTrack || alsoInOrder.has(`${prevPos}>${pos}`) || freeExit) inOrder++;
      else {
        const type = track === prev.track ? 'repeat' : prevPos === N || pos > prevPos ? 'skip' : 'back';
        counts[type]++;
        const skipped = type === 'skip' ? (prevPos === N ? pos - 1 : pos - prevPos - 1) : 0;
        events.push(makeEvent(type, from, to, expectedTrack, ctx, { skipped }));
      }
    }
    prev = { s, track };
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
    // Mudanças de ordem registradas (para avisar na tela).
    changes: versions.filter((v) => v.from).map((v) => ({ fromTs: v.fromTs, note: v.note })),
    // Regras extras de "na ordem" (para avisar na tela).
    rules: [...(playlist.alsoInOrder || []), ...(playlist.noSkipFrom || [])].map((r) => r.note).filter(Boolean),
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

function makeEvent(type, from, to, expectedTrack, { v, index }, extra) {
  const title = (track) => index.tracks[track - 1].title;
  return {
    type,
    id: `${type}:${to.s.id}`,
    ts: to.s.ts,
    scrobbleId: to.s.id,
    fromId: from.s.id,
    from: { pos: from.pos, title: title(from.track) },
    to: { pos: to.pos, title: title(to.track) },
    expected: expectedTrack ? { pos: v.posOf.get(expectedTrack), title: title(expectedTrack) } : null,
    skipped: extra.skipped || 0,
    outside: (extra.outside || []).map((o) => ({ id: o.id, ts: o.ts, artist: o.artist, track: o.track })),
  };
}
