/**
 * Modelo normalizado de scrobble, independente da fonte.
 *
 * @typedef {Object} Scrobble
 * @property {string} id         identificador estável dentro da auditoria
 * @property {string} source     id da fonte ('lastfm', ...)
 * @property {number} ts         Unix timestamp em segundos (UTC)
 * @property {string} artist
 * @property {string} track
 * @property {string} album      '' quando a fonte não informa
 * @property {string} artistMbid '' quando a fonte não informa
 * @property {string} trackMbid
 * @property {string} albumMbid
 * @property {string} url        '' quando a fonte não informa
 * @property {string} image      '' quando a fonte não informa
 *
 * Campos derivados (calculados pela auditoria, nunca inventados):
 * @property {number|null} [durationMs] duração conhecida da faixa, ou null
 * @property {number|null} [gapPrev]    segundos desde o scrobble anterior
 * @property {number|null} [gapNext]    segundos até o próximo scrobble
 */

/** Chave de identidade de conteúdo de um scrobble (sem o índice de duplicata). */
export function contentKey(s) {
  return `${s.ts}\u0001${s.artist}\u0001${s.track}\u0001${s.album}`;
}

/** Chave de uma faixa (para agrupar/contar). Case-insensitive, como a Last.fm. */
export function trackKey(s) {
  return `${s.artist.toLowerCase()}\u0001${s.track.toLowerCase()}`;
}

export function artistKey(s) {
  return s.artist.toLowerCase();
}

export function albumKey(s) {
  return s.album ? `${s.artist.toLowerCase()}\u0001${s.album.toLowerCase()}` : '';
}

/**
 * Acumula scrobbles vindos de respostas paginadas que podem se sobrepor.
 *
 * Problema: ao paginar por cursor de tempo, a mesma página pode ser lida mais
 * de uma vez (sobreposição proposital no segundo de fronteira). Deduplicar só
 * por conteúdo apagaria duplicatas legítimas (dois scrobbles idênticos no
 * mesmo segundo). Solução: para cada chave de conteúdo guardamos a MAIOR
 * multiplicidade observada dentro de UMA única resposta. Como cada resposta é
 * um recorte contíguo do histórico, isso reconstrói a contagem exata.
 */
export class ScrobbleCollector {
  constructor() {
    /** @type {Map<string, {scrobble: Scrobble, count: number}>} */
    this.entries = new Map();
    this.size = 0;
  }

  /** @param {Scrobble[]} batch scrobbles de UMA resposta da API */
  addBatch(batch) {
    const local = new Map();
    for (const s of batch) {
      const k = contentKey(s);
      const e = local.get(k);
      if (e) e.count++;
      else local.set(k, { scrobble: s, count: 1 });
    }
    let added = 0;
    for (const [k, e] of local) {
      const prev = this.entries.get(k);
      if (!prev) {
        this.entries.set(k, e);
        added += e.count;
      } else if (e.count > prev.count) {
        added += e.count - prev.count;
        prev.count = e.count;
      }
    }
    this.size += added;
    return added;
  }

  /** Lista final, ordenada do mais recente para o mais antigo, com ids estáveis. */
  toArray() {
    const out = [];
    for (const [k, { scrobble, count }] of this.entries) {
      const base = hashString(k);
      for (let i = 0; i < count; i++) {
        out.push({ ...scrobble, id: `${scrobble.ts}-${base}${i ? `-${i}` : ''}` });
      }
    }
    out.sort(compareNewestFirst);
    return out;
  }
}

/** Ordenação determinística: ts desc, depois artista/música/álbum. */
export function compareNewestFirst(a, b) {
  return b.ts - a.ts || cmp(a.artist, b.artist) || cmp(a.track, b.track) || cmp(a.album, b.album) || cmp(a.id || '', b.id || '');
}

function cmp(a, b) {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** Hash FNV-1a 32 bits em base36 — só para ids curtos e estáveis. */
export function hashString(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(36);
}

/**
 * Calcula campos derivados que dependem da sequência completa
 * (intervalo para o scrobble anterior/seguinte). Recebe lista newest-first.
 */
export function annotateGaps(scrobbles) {
  for (let i = 0; i < scrobbles.length; i++) {
    const s = scrobbles[i];
    const newer = scrobbles[i - 1];
    const older = scrobbles[i + 1];
    s.gapPrev = older ? s.ts - older.ts : null;
    s.gapNext = newer ? newer.ts - s.ts : null;
  }
  return scrobbles;
}
