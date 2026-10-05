/**
 * Conversões de tempo com timezone explícito, sem dependências.
 *
 * Convenções:
 *  - Timestamps de scrobble são Unix em SEGUNDOS (como a Last.fm envia).
 *  - "Wall time" = data/hora de relógio em um timezone IANA (ex.: America/Sao_Paulo).
 *  - Toda conversão wall time -> instante usa Intl, então respeita horário de verão.
 */

const dtfCache = new Map();

function partsFormatter(timeZone) {
  let f = dtfCache.get(timeZone);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      weekday: 'short',
    });
    dtfCache.set(timeZone, f);
  }
  return f;
}

const WEEKDAYS = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

/** Componentes de relógio de um instante (ms) em um timezone. */
export function getZonedParts(epochMs, timeZone) {
  const out = {};
  for (const { type, value } of partsFormatter(timeZone).formatToParts(new Date(epochMs))) {
    if (type === 'weekday') out.weekday = WEEKDAYS[value];
    else if (type !== 'literal') out[type] = Number(value);
  }
  if (out.hour === 24) out.hour = 0; // alguns engines antigos
  return out;
}

/**
 * Versão rápida de getZonedParts para formatar/filtrar milhares de scrobbles.
 * Transições de timezone ocorrem em instantes alinhados a 15 min (UTC), então
 * o offset é constante dentro de cada bloco de 15 min e pode ser cacheado.
 */
const offsetCache = new Map();
export function localParts(epochSec, timeZone) {
  const bucket = Math.floor(epochSec / 900);
  const key = `${timeZone}|${bucket}`;
  let off = offsetCache.get(key);
  if (off === undefined) {
    off = getOffsetMs(bucket * 900 * 1000, timeZone);
    if (offsetCache.size > 200000) offsetCache.clear();
    offsetCache.set(key, off);
  }
  const d = new Date(epochSec * 1000 + off);
  return {
    year: d.getUTCFullYear(),
    month: d.getUTCMonth() + 1,
    day: d.getUTCDate(),
    hour: d.getUTCHours(),
    minute: d.getUTCMinutes(),
    second: d.getUTCSeconds(),
    weekday: d.getUTCDay(),
  };
}

/** Offset do timezone (ms) no instante dado: local = utc + offset. */
export function getOffsetMs(epochMs, timeZone) {
  const p = getZonedParts(epochMs, timeZone);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return asUtc - Math.floor(epochMs / 1000) * 1000;
}

/**
 * Converte wall time em um timezone para epoch ms.
 * Retorna { epochMs, valid } — `valid=false` quando o horário não existe
 * (lacuna de horário de verão); nesse caso o instante retornado é o
 * imediatamente posterior à lacuna. Em horários ambíguos (fim do horário de
 * verão) retorna a primeira ocorrência.
 */
export function zonedToEpoch({ year, month, day, hour = 0, minute = 0, second = 0 }, timeZone) {
  const wall = Date.UTC(year, month - 1, day, hour, minute, second);
  // Duas candidatas: offset antes e depois da possível transição.
  const o1 = getOffsetMs(wall - 864e5 / 2, timeZone);
  const o2 = getOffsetMs(wall + 864e5 / 2, timeZone);
  const candidates = [...new Set([wall - o1, wall - o2])].sort((a, b) => a - b);
  for (const c of candidates) {
    if (getOffsetMs(c, timeZone) === wall - c) return { epochMs: c, valid: true };
  }
  // Lacuna: nenhuma candidata cai no wall time pedido.
  return { epochMs: Math.max(...candidates), valid: false };
}

/** "2026-10-05T08:00" ou "2026-10-05T08:00:30" -> partes. null se inválido. */
export function parseDateTimeInput(value) {
  const m = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?$/.exec(String(value || '').trim());
  if (!m) return null;
  const [year, month, day, hour, minute, second] = m.slice(1).map((v) => (v === undefined ? 0 : Number(v)));
  if (month < 1 || month > 12 || day < 1 || day > 31 || hour > 23 || minute > 59 || second > 59) return null;
  // Rejeita 31/02 etc.
  const check = new Date(Date.UTC(year, month - 1, day));
  if (check.getUTCMonth() !== month - 1) return null;
  return { year, month, day, hour, minute, second };
}

/** "2026-10-05" -> partes (00:00:00). */
export function parseDateInput(value) {
  return parseDateTimeInput(`${value}T00:00:00`);
}

/** "HH:MM" ou "HH:MM:SS" -> segundos desde 00:00. null se inválido. */
export function parseTimeOfDay(value) {
  const m = /^(\d{2}):(\d{2})(?::(\d{2}))?$/.exec(String(value || '').trim());
  if (!m) return null;
  const [h, mi, s] = m.slice(1).map((v) => (v === undefined ? 0 : Number(v)));
  if (h > 23 || mi > 59 || s > 59) return null;
  return h * 3600 + mi * 60 + s;
}

const pad = (n, w = 2) => String(n).padStart(w, '0');

/** Epoch segundos -> valor para <input type="datetime-local" step="1">. */
export function epochToInputValue(epochSec, timeZone) {
  const p = localParts(epochSec, timeZone);
  return `${p.year}-${pad(p.month)}-${pad(p.day)}T${pad(p.hour)}:${pad(p.minute)}:${pad(p.second)}`;
}

/** Epoch segundos -> "05/10/2026 08:00:12" no timezone. */
export function formatDateTime(epochSec, timeZone, { seconds = true } = {}) {
  const p = localParts(epochSec, timeZone);
  const time = seconds ? `${pad(p.hour)}:${pad(p.minute)}:${pad(p.second)}` : `${pad(p.hour)}:${pad(p.minute)}`;
  return `${pad(p.day)}/${pad(p.month)}/${p.year} ${time}`;
}

export function formatDate(epochSec, timeZone) {
  const p = localParts(epochSec, timeZone);
  return `${pad(p.day)}/${pad(p.month)}/${p.year}`;
}

export function formatTime(epochSec, timeZone) {
  const p = localParts(epochSec, timeZone);
  return `${pad(p.hour)}:${pad(p.minute)}:${pad(p.second)}`;
}

/** Epoch segundos -> ISO 8601 em UTC ("2026-10-05T11:00:00Z"). */
export function toIsoUtc(epochSec) {
  return new Date(epochSec * 1000).toISOString().replace('.000Z', 'Z');
}

/** Epoch segundos -> ISO 8601 com offset local ("2026-10-05T08:00:00-03:00"). */
export function toIsoZoned(epochSec, timeZone) {
  const ms = epochSec * 1000;
  return `${epochToInputValue(epochSec, timeZone)}${formatOffset(getOffsetMs(ms, timeZone), true)}`;
}

/** Offset ms -> "UTC−03:00" (ou "-03:00" com bare=true). */
export function formatOffset(offsetMs, bare = false) {
  const sign = offsetMs < 0 ? '-' : '+';
  const abs = Math.abs(offsetMs) / 60000;
  const s = `${sign}${pad(Math.floor(abs / 60))}:${pad(abs % 60)}`;
  return bare ? s : `UTC${s.replace('-', '−')}`;
}

/** Descrição do timezone em um instante: "America/Sao_Paulo (UTC−03:00)". */
export function describeTimeZone(timeZone, epochSec = Date.now() / 1000) {
  return `${timeZone} (${formatOffset(getOffsetMs(epochSec * 1000, timeZone))})`;
}

export function browserTimeZone() {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    return 'UTC';
  }
}

export function isValidTimeZone(tz) {
  if (!tz) return false;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

const FALLBACK_ZONES = [
  'UTC', 'America/Sao_Paulo', 'America/Manaus', 'America/Fortaleza', 'America/Recife', 'America/Belem',
  'America/Cuiaba', 'America/Rio_Branco', 'America/Noronha', 'America/New_York', 'America/Chicago',
  'America/Denver', 'America/Los_Angeles', 'America/Mexico_City', 'America/Bogota', 'America/Lima',
  'America/Santiago', 'America/Argentina/Buenos_Aires', 'Europe/London', 'Europe/Lisbon', 'Europe/Madrid',
  'Europe/Paris', 'Europe/Berlin', 'Europe/Moscow', 'Africa/Johannesburg', 'Asia/Dubai', 'Asia/Kolkata',
  'Asia/Shanghai', 'Asia/Tokyo', 'Asia/Seoul', 'Australia/Sydney', 'Pacific/Auckland',
];

export function listTimeZones() {
  try {
    const zones = Intl.supportedValuesOf('timeZone');
    return zones.includes('UTC') ? zones : ['UTC', ...zones];
  } catch {
    return FALLBACK_ZONES;
  }
}

/** Segundos desde 00:00 (wall time) de um instante no timezone. */
export function secondsOfDay(epochSec, timeZone) {
  const p = localParts(epochSec, timeZone);
  return p.hour * 3600 + p.minute * 60 + p.second;
}

/** "YYYY-MM-DD" do instante no timezone (útil para agrupar por dia). */
export function dayKey(epochSec, timeZone) {
  const p = localParts(epochSec, timeZone);
  return `${p.year}-${pad(p.month)}-${pad(p.day)}`;
}

/** Duração em segundos -> "1h 02m 03s" / "3m 20s" / "45s". */
export function formatDuration(totalSec) {
  if (totalSec == null || !Number.isFinite(totalSec)) return '—';
  const s = Math.round(totalSec);
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  const r = s % 60;
  if (d) return `${d}d ${pad(h)}h ${pad(m)}m`;
  if (h) return `${h}h ${pad(m)}m ${pad(r)}s`;
  if (m) return `${m}m ${pad(r)}s`;
  return `${r}s`;
}

/** Duração de um período em palavras: "7 dias", "1 dia e 4 horas", "30 minutos". */
export function formatSpan(totalSec) {
  const s = Math.max(0, Math.round(totalSec));
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  const word = (n, one, many) => `${n} ${n === 1 ? one : many}`;
  const parts = [];
  if (d) parts.push(word(d, 'dia', 'dias'));
  if (h) parts.push(word(h, 'hora', 'horas'));
  if (m && !d) parts.push(word(m, 'minuto', 'minutos'));
  if (!parts.length) return word(s, 'segundo', 'segundos');
  return parts.slice(0, 2).join(' e ');
}

/** Duração de faixa em ms -> "3:45". */
export function formatTrackLength(ms) {
  if (ms == null) return '—';
  const s = Math.round(ms / 1000);
  return `${Math.floor(s / 60)}:${pad(s % 60)}`;
}
