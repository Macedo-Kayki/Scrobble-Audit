import { trackKey, artistKey, albumKey } from './model.js';
import { localParts, parseTimeOfDay } from './time.js';
import { AUDIT } from '../config.js';

/**
 * Filtros, ordenação e agrupamento — funções puras sobre a lista de scrobbles
 * de uma auditoria. Datas e horários são interpretados no timezone informado.
 */
export const DEFAULT_FILTERS = Object.freeze({
  query: '',          // busca livre em artista/música/álbum
  artist: '',
  track: '',
  album: '',
  exact: false,       // true = igualdade (ignorando caixa/acentos); false = contém
  dateFrom: '',       // YYYY-MM-DD (inclusivo)
  dateTo: '',         // YYYY-MM-DD (inclusivo)
  timeFrom: '',       // HH:MM[:SS] — janela de horário do dia; aceita virar a meia-noite
  timeTo: '',
  weekdays: [],       // 0=dom ... 6=sáb; vazio = todos
  durationMin: '',    // segundos
  durationMax: '',
  includeUnknownDuration: true,
  playsMin: '',       // reproduções da música no período auditado
  playsMax: '',
  shortGapOnly: false,
});

export const SORT_OPTIONS = [
  { id: 'time_desc', label: 'Mais recente primeiro' },
  { id: 'time_asc', label: 'Mais antigo primeiro' },
  { id: 'artist', label: 'Artista (A–Z)' },
  { id: 'track', label: 'Música (A–Z)' },
  { id: 'album', label: 'Álbum (A–Z)' },
  { id: 'plays_desc', label: 'Mais scrobbles' },
  { id: 'plays_asc', label: 'Menos scrobbles' },
];

export const GROUP_MODES = [
  { id: 'none', label: 'Scrobbles' },
  { id: 'track', label: 'Por música' },
  { id: 'artist', label: 'Por artista' },
  { id: 'album', label: 'Por álbum' },
];

const collator = new Intl.Collator('pt-BR', { sensitivity: 'base', numeric: true });

const normCache = new Map();
/** Minúsculas e sem acentos, para busca tolerante. */
export function normalizeText(s) {
  const str = String(s ?? '');
  let n = normCache.get(str);
  if (n === undefined) {
    n = str.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
    if (normCache.size > 100000) normCache.clear();
    normCache.set(str, n);
  }
  return n;
}

export function countBy(scrobbles, keyFn) {
  const m = new Map();
  for (const s of scrobbles) {
    const k = keyFn(s);
    if (k) m.set(k, (m.get(k) || 0) + 1);
  }
  return m;
}

const num = (v) => (v === '' || v == null || !Number.isFinite(Number(v)) ? null : Number(v));

/** Quantos filtros estão ativos (para badge na UI). */
export function activeFilterCount(f) {
  let n = 0;
  for (const k of ['query', 'artist', 'track', 'album', 'dateFrom', 'dateTo', 'timeFrom', 'timeTo', 'durationMin', 'durationMax', 'playsMin', 'playsMax']) {
    if (String(f[k] ?? '').trim()) n++;
  }
  if (f.weekdays?.length) n++;
  if (f.shortGapOnly) n++;
  return n;
}

/**
 * @param {import('./model.js').Scrobble[]} scrobbles  conjunto completo da auditoria
 * @param {typeof DEFAULT_FILTERS} filters
 * @param {{ timeZone: string, durations?: Map<string, number|null>, playCounts?: Map<string, number> }} ctx
 */
export function filterScrobbles(scrobbles, filters, ctx) {
  const f = { ...DEFAULT_FILTERS, ...filters };
  const tz = ctx.timeZone;
  const match = textMatcher(f.exact);
  const q = normalizeText(f.query);
  const artist = normalizeText(f.artist);
  const track = normalizeText(f.track);
  const album = normalizeText(f.album);
  const dateFrom = /^\d{4}-\d{2}-\d{2}$/.test(f.dateFrom) ? f.dateFrom : null;
  const dateTo = /^\d{4}-\d{2}-\d{2}$/.test(f.dateTo) ? f.dateTo : null;
  const tFrom = parseTimeOfDay(f.timeFrom);
  const tTo = parseTimeOfDay(f.timeTo);
  const weekdays = f.weekdays?.length ? new Set(f.weekdays.map(Number)) : null;
  const dMin = num(f.durationMin);
  const dMax = num(f.durationMax);
  const pMin = num(f.playsMin);
  const pMax = num(f.playsMax);
  const needsLocal = dateFrom || dateTo || tFrom != null || tTo != null || weekdays;
  const playCounts = pMin != null || pMax != null ? ctx.playCounts || countBy(scrobbles, trackKey) : null;
  const durations = ctx.durations || new Map();
  const gap = AUDIT.shortGapSeconds;

  return scrobbles.filter((s) => {
    if (q) {
      const hay = `${normalizeText(s.artist)}\u0001${normalizeText(s.track)}\u0001${normalizeText(s.album)}`;
      if (!hay.includes(q)) return false;
    }
    if (artist && !match(s.artist, artist)) return false;
    if (track && !match(s.track, track)) return false;
    if (album && !match(s.album, album)) return false;

    if (needsLocal) {
      const p = localParts(s.ts, tz);
      if (dateFrom || dateTo) {
        const d = `${p.year}-${String(p.month).padStart(2, '0')}-${String(p.day).padStart(2, '0')}`;
        if (dateFrom && d < dateFrom) return false;
        if (dateTo && d > dateTo) return false;
      }
      if (tFrom != null || tTo != null) {
        const sod = p.hour * 3600 + p.minute * 60 + p.second;
        if (!inTimeWindow(sod, tFrom, tTo)) return false;
      }
      if (weekdays && !weekdays.has(p.weekday)) return false;
    }

    if (dMin != null || dMax != null) {
      const ms = durations.get(trackKey(s));
      if (ms == null) {
        if (!f.includeUnknownDuration) return false;
      } else {
        const sec = ms / 1000;
        if (dMin != null && sec < dMin) return false;
        if (dMax != null && sec > dMax) return false;
      }
    }

    if (playCounts) {
      const c = playCounts.get(trackKey(s)) || 0;
      if (pMin != null && c < pMin) return false;
      if (pMax != null && c > pMax) return false;
    }

    if (f.shortGapOnly) {
      const short = (s.gapPrev != null && s.gapPrev < gap) || (s.gapNext != null && s.gapNext < gap);
      if (!short) return false;
    }
    return true;
  });
}

/** Janela de horário do dia, inclusiva nas duas pontas; from > to vira a meia-noite. */
export function inTimeWindow(sod, from, to) {
  if (from == null && to == null) return true;
  if (from == null) return sod <= to;
  if (to == null) return sod >= from;
  return from <= to ? sod >= from && sod <= to : sod >= from || sod <= to;
}

function textMatcher(exact) {
  return exact ? (value, needle) => normalizeText(value) === needle : (value, needle) => normalizeText(value).includes(needle);
}

/** Ordena scrobbles individuais. Retorna uma nova lista. */
export function sortScrobbles(list, sort, { playCounts } = {}) {
  const out = [...list];
  const byTimeDesc = (a, b) => b.ts - a.ts || (a.id < b.id ? -1 : 1);
  const counts = sort.startsWith('plays') ? playCounts || countBy(list, trackKey) : null;
  const cmps = {
    time_desc: byTimeDesc,
    time_asc: (a, b) => -byTimeDesc(a, b),
    artist: (a, b) => collator.compare(a.artist, b.artist) || collator.compare(a.track, b.track) || byTimeDesc(a, b),
    track: (a, b) => collator.compare(a.track, b.track) || collator.compare(a.artist, b.artist) || byTimeDesc(a, b),
    album: (a, b) => collator.compare(a.album || '￿', b.album || '￿') || byTimeDesc(a, b),
    plays_desc: (a, b) => counts.get(trackKey(b)) - counts.get(trackKey(a)) || collator.compare(a.track, b.track) || byTimeDesc(a, b),
    plays_asc: (a, b) => counts.get(trackKey(a)) - counts.get(trackKey(b)) || collator.compare(a.track, b.track) || byTimeDesc(a, b),
  };
  return out.sort(cmps[sort] || byTimeDesc);
}

/**
 * Agrupa por música, artista ou álbum.
 * @returns {{ key: string, artist: string, track: string, album: string, count: number,
 *             firstTs: number, lastTs: number, items: object[] }[]}
 */
export function groupScrobbles(list, mode) {
  const keyFn = { track: trackKey, artist: artistKey, album: albumKey }[mode];
  if (!keyFn) return [];
  const groups = new Map();
  for (const s of list) {
    const k = keyFn(s);
    if (!k) continue; // sem álbum informado não entra no agrupamento por álbum
    let g = groups.get(k);
    if (!g) {
      g = { key: k, artist: s.artist, track: mode === 'track' ? s.track : '', album: mode === 'album' ? s.album : '', image: '', count: 0, firstTs: s.ts, lastTs: s.ts, items: [] };
      groups.set(k, g);
    }
    g.count++;
    g.items.push(s);
    if (!g.image && s.image) g.image = s.image;
    if (s.ts < g.firstTs) g.firstTs = s.ts;
    if (s.ts > g.lastTs) g.lastTs = s.ts;
  }
  return [...groups.values()];
}

export function sortGroups(groups, sort, mode) {
  const label = (g) => (mode === 'track' ? g.track : mode === 'album' ? g.album : g.artist);
  const cmps = {
    time_desc: (a, b) => b.lastTs - a.lastTs,
    time_asc: (a, b) => a.firstTs - b.firstTs,
    artist: (a, b) => collator.compare(a.artist, b.artist) || collator.compare(label(a), label(b)),
    track: (a, b) => collator.compare(label(a), label(b)) || collator.compare(a.artist, b.artist),
    album: (a, b) => collator.compare(label(a), label(b)),
    plays_desc: (a, b) => b.count - a.count || collator.compare(label(a), label(b)),
    plays_asc: (a, b) => a.count - b.count || collator.compare(label(a), label(b)),
  };
  return [...groups].sort(cmps[sort] || cmps.plays_desc);
}
