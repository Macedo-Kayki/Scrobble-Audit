/**
 * Persistência exclusivamente em localStorage, com namespace e versão.
 * Toda leitura/escrita é protegida: em modo privado ou com cota esgotada a
 * aplicação continua funcionando, apenas sem persistir.
 */
const PREFIX = 'scrobble-audit:v1:';

export const KEYS = Object.freeze({
  settings: 'settings',
  filters: 'filters',
  form: 'form',
  history: 'history',
  lastAudit: 'lastAudit',
  ranking: 'ranking',
  durations: 'durations',
  ui: 'ui',
});

function backend() {
  try {
    return globalThis.localStorage || null;
  } catch {
    return null;
  }
}

export function load(key, fallback) {
  try {
    const raw = backend()?.getItem(PREFIX + key);
    return raw == null ? fallback : JSON.parse(raw);
  } catch {
    return fallback;
  }
}

/** @returns {{ ok: boolean, quota?: boolean, error?: unknown }} */
export function save(key, value) {
  const ls = backend();
  if (!ls) return { ok: false };
  try {
    ls.setItem(PREFIX + key, JSON.stringify(value));
    return { ok: true };
  } catch (error) {
    const quota = error?.name === 'QuotaExceededError' || error?.code === 22 || error?.code === 1014;
    return { ok: false, quota, error };
  }
}

export function remove(key) {
  try {
    backend()?.removeItem(PREFIX + key);
  } catch {
    /* ignora */
  }
}

export function clearAll() {
  const ls = backend();
  if (!ls) return;
  try {
    for (const k of Object.keys(ls)) if (k.startsWith(PREFIX)) ls.removeItem(k);
  } catch {
    /* ignora */
  }
}

/** Bytes aproximados usados pela aplicação (UTF-16 => 2 bytes/char). */
export function usageBytes() {
  const ls = backend();
  if (!ls) return 0;
  let total = 0;
  try {
    for (const k of Object.keys(ls)) if (k.startsWith(PREFIX)) total += (k.length + (ls.getItem(k) || '').length) * 2;
  } catch {
    /* ignora */
  }
  return total;
}

// ---------- Codificação compacta de scrobbles ----------
// Strings repetidas (artistas, álbuns, URLs) vão para uma tabela; cada
// scrobble vira uma linha de índices. Reduz o tamanho em ~5–10x.

const FIELDS = ['artist', 'track', 'album', 'artistMbid', 'trackMbid', 'albumMbid', 'url', 'image'];

export function encodeScrobbles(list) {
  const strings = [];
  const index = new Map();
  const idx = (s) => {
    const v = s || '';
    let i = index.get(v);
    if (i === undefined) {
      i = strings.length;
      strings.push(v);
      index.set(v, i);
    }
    return i;
  };
  const rows = list.map((s) => [s.ts, idx(s.source), idx(s.id), ...FIELDS.map((f) => idx(s[f]))]);
  return { v: 1, fields: FIELDS, strings, rows };
}

export function decodeScrobbles(enc) {
  if (!enc || enc.v !== 1 || !Array.isArray(enc.rows)) return [];
  const { strings, rows, fields = FIELDS } = enc;
  return rows.map((r) => {
    const s = { ts: r[0], source: strings[r[1]], id: strings[r[2]] };
    fields.forEach((f, i) => {
      s[f] = strings[r[3 + i]] ?? '';
    });
    return s;
  });
}
