import { AppError, ErrorKind } from './errors.js';
import { ScrobbleCollector, annotateGaps, trackKey } from './model.js';
import { epochToInputValue, isValidTimeZone } from './time.js';
import { TIME_ZONE } from '../config.js';

/**
 * Importação dos arquivos que o próprio app exporta:
 *  - auditoria em JSON (completa ou filtrada) ou CSV;
 *  - lista de horários de uma música (JSON array ou CSV);
 *  - ranking em JSON ou CSV.
 *
 * Regras: cada linha é validada; linhas inválidas são descartadas e contadas;
 * nada é inventado — campos ausentes ficam vazios e intervalos que o arquivo
 * não informa são marcados como derivados dos próprios dados.
 */

export const MAX_IMPORT_BYTES = 200 * 1024 * 1024;

/**
 * @param {string} text conteúdo do arquivo
 * @param {{ fileName?: string, fallbackTimeZone: string, now?: number }} opts
 * @returns {{ kind: 'audit', audit: object, durations: Map<string, number>, skipped: number, warnings: string[] }
 *         | { kind: 'ranking', ranking: object, skipped: number, warnings: string[] }}
 */
export function parseImport(text, { fileName = '', fallbackTimeZone = TIME_ZONE, now = Date.now() }) {
  const body = String(text || '').replace(/^﻿/, '').trim();
  if (!body) throw invalid('O arquivo está vazio.');
  const ctx = { fileName, fallbackTimeZone, now };
  if (body[0] === '{' || body[0] === '[') {
    let data;
    try {
      data = JSON.parse(body);
    } catch {
      throw invalid('O arquivo está corrompido ou não foi criado pelo Scrobble Audit.');
    }
    return fromJSON(data, ctx);
  }
  return fromCSV(parseCSV(body), ctx);
}

/* ---------------- JSON ---------------- */

function fromJSON(data, ctx) {
  if (Array.isArray(data)) return buildAudit({ records: data, format: 'json', ctx });
  if (data && (Array.isArray(data.ranking) || Array.isArray(data.entries))) return rankingFromJSON(data, ctx);
  if (data && Array.isArray(data.scrobbles)) {
    const r = data.range || {};
    return buildAudit({
      records: data.scrobbles,
      format: 'json',
      ctx,
      meta: {
        username: data.username,
        source: data.source,
        from: toInt(r.from_unix),
        to: toInt(r.to_unix),
        timeZone: r.timezone || data.display_timezone,
        inclusiveEnd: typeof r.inclusive_end === 'boolean' ? r.inclusive_end : true,
        scope: data.scope === 'filtered' ? 'filtered' : 'all',
        filters: data.scope === 'filtered' ? data.filters || null : null,
        verification: data.verification || null,
        requests: toInt(data.requests),
        exportedAt: Date.parse(data.generatedAt || data.fetched_at) || null,
        auditedAt: Date.parse(data.fetched_at) || null,
      },
    });
  }
  throw invalid('Arquivo não reconhecido. Use um arquivo exportado pelo Scrobble Audit.');
}

/* ---------------- CSV ---------------- */

function fromCSV(rows, ctx) {
  if (rows.length < 2) throw invalid('A planilha está vazia.');
  const header = rows[0].map((h) => h.trim().toLowerCase());
  const records = rows.slice(1).filter((r) => r.some((c) => c !== '')).map((r) => Object.fromEntries(header.map((h, i) => [h, unprotect(r[i] ?? '')])));
  if (header.includes('position') && header.includes('username') && header.includes('scrobbles')) return rankingFromRecords(records, ctx);
  if (header.includes('timestamp_unix') || header.includes('datetime_utc')) return buildAudit({ records, format: 'csv', ctx });
  throw invalid('Planilha não reconhecida. Use uma planilha exportada pelo Scrobble Audit.');
}

/** Desfaz a proteção contra fórmulas aplicada na exportação ('=..., '+..., ...). */
function unprotect(v) {
  return /^'[=+\-@\t\r]/.test(v) ? v.slice(1) : v;
}

/** Parser CSV (RFC 4180) com detecção de separador: vírgula, ponto e vírgula ou tab. */
export function parseCSV(text) {
  const firstLine = text.slice(0, text.search(/\r?\n/) === -1 ? undefined : text.search(/\r?\n/));
  const counts = { ',': 0, ';': 0, '\t': 0 };
  let q = false;
  for (const ch of firstLine) {
    if (ch === '"') q = !q;
    else if (!q && ch in counts) counts[ch]++;
  }
  const delim = Object.entries(counts).sort((a, b) => b[1] - a[1])[0][0];

  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else inQuotes = false;
      } else field += ch;
    } else if (ch === '"') inQuotes = true;
    else if (ch === delim) {
      row.push(field);
      field = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else field += ch;
  }
  if (field !== '' || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

/* ---------------- Auditoria ---------------- */

function buildAudit({ records, format, ctx, meta = {} }) {
  const collector = new ScrobbleCollector();
  const valid = [];
  const durations = new Map();
  let skipped = 0;
  for (const r of records) {
    const s = recordToScrobble(r);
    if (!s) {
      skipped++;
      continue;
    }
    valid.push(s);
    const ms = toInt(r?.duration_ms);
    if (ms > 0) durations.set(trackKey(s), ms);
  }
  if (!valid.length) throw invalid('Não encontramos nenhum scrobble no arquivo.');
  collector.addBatch(valid); // um único lote: duplicatas legítimas são preservadas
  const scrobbles = annotateGaps(collector.toArray());

  const warnings = [];
  const first = records.find((r) => r && typeof r === 'object') || {};
  const username = String(meta.username || first.username || '').trim() || 'importado';
  const source = String(meta.source || first.source || 'lastfm');
  const tzCandidate = meta.timeZone || first.timezone;
  const timeZone = isValidTimeZone(tzCandidate) ? tzCandidate : ctx.fallbackTimeZone;


  const minTs = scrobbles[scrobbles.length - 1].ts;
  const maxTs = scrobbles[0].ts;
  let from = Number.isInteger(meta.from) && meta.from > 0 ? meta.from : null;
  let to = Number.isInteger(meta.to) && meta.to > 0 ? meta.to : null;
  const rangeDerived = from == null || to == null || from > to;
  if (rangeDerived) {
    from = minTs;
    to = maxTs;
    warnings.push('A planilha não diz qual período foi auditado; usamos do primeiro ao último scrobble.');
  }
  const outside = scrobbles.filter((s) => s.ts < from || s.ts > to).length;
  if (outside) warnings.push(`${outside} scrobble(s) estão fora do período informado no arquivo.`);
  if (skipped) warnings.push(`${skipped} linha(s) com problema foram ignoradas.`);
  if (meta.scope === 'filtered') warnings.push('Este arquivo tem só uma parte da auditoria original (o que estava filtrado). Os totais se referem só a essa parte.');

  const inclusiveEnd = meta.inclusiveEnd !== false;
  const importedAt = ctx.now;
  const v = meta.verification;
  return {
    kind: 'audit',
    durations,
    skipped,
    warnings,
    audit: {
      id: `import:${source}:${username.toLowerCase()}:${from}-${to}:${importedAt}`,
      source,
      sourceName: source,
      username,
      user: null,
      range: {
        from,
        to,
        requestedTo: inclusiveEnd ? to : to + 1,
        timeZone,
        inclusiveEnd,
        startInput: epochToInputValue(from, timeZone),
        endInput: epochToInputValue(inclusiveEnd ? to : to + 1, timeZone),
        warnings: [],
      },
      scrobbles,
      verification: {
        status: 'imported',
        expected: v && Number.isFinite(v.expected) ? v.expected : null,
        fetchedInWindow: scrobbles.length,
        original: v ? { status: v.status, expected: v.expected, fetchedInWindow: v.fetchedInWindow } : null,
      },
      requests: meta.requests || 0,
      retries: 0,
      startedAt: meta.auditedAt || importedAt,
      finishedAt: meta.auditedAt || importedAt,
      durationMs: 0,
      imported: {
        fileName: ctx.fileName,
        format,
        scope: meta.scope || 'all',
        filters: meta.filters || null,
        rangeDerived,
        exportedAt: meta.exportedAt || null,
        importedAt,
      },
    },
  };
}

function recordToScrobble(r) {
  if (!r || typeof r !== 'object') return null;
  let ts = toInt(r.timestamp_unix ?? r.ts);
  if (!(ts > 0) && r.datetime_utc) ts = Math.floor(Date.parse(r.datetime_utc) / 1000);
  const artist = str(r.artist);
  const track = str(r.track);
  if (!(ts > 0) || !artist || !track) return null;
  return {
    id: '',
    source: str(r.source) || 'lastfm',
    ts,
    artist,
    track,
    album: str(r.album),
    artistMbid: str(r.artist_mbid),
    trackMbid: str(r.track_mbid),
    albumMbid: str(r.album_mbid),
    url: str(r.url),
    image: str(r.image_url),
  };
}

/* ---------------- Ranking ---------------- */

function rankingFromJSON(data, ctx) {
  const range = normalizeRange(data.range, ctx);
  if (!range) throw invalid('O arquivo de ranking não informa um período válido.');
  // Exportações novas trazem `entries` completas (sem perdas); antigas, só `ranking` (registros planos).
  if (Array.isArray(data.entries)) {
    let skipped = 0;
    const entries = [];
    for (const e of data.entries) {
      if (!e || typeof e.username !== 'string' || !Number.isFinite(e.total)) {
        skipped++;
        continue;
      }
      entries.push({ ...e, rangeKey: `${range.from}-${range.to}` });
    }
    return finishRanking(range, entries, skipped);
  }
  return rankingFromRecords(data.ranking, ctx, range);
}

function rankingFromRecords(records, ctx, rangeIn = null) {
  const first = records[0] || {};
  const range =
    rangeIn ||
    normalizeRange(
      {
        from: Math.floor(Date.parse(first.range_from_utc) / 1000),
        to: Math.floor(Date.parse(first.range_to_utc) / 1000),
        timeZone: first.timezone,
        inclusiveEnd: true,
      },
      ctx,
    );
  if (!range) throw invalid('O arquivo de ranking não informa um período válido.');
  let skipped = 0;
  const entries = [];
  for (const r of records) {
    const total = toInt(r.scrobbles);
    if (!r.username || !Number.isFinite(total)) {
      skipped++;
      continue;
    }
    entries.push({
      username: String(r.username),
      source: String(r.source || 'lastfm'),
      image: '',
      total,
      uniqueTracks: toIntOrNull(r.unique_tracks),
      uniqueArtists: toIntOrNull(r.unique_artists),
      topArtist: r.top_artist ? { artist: String(r.top_artist), count: toIntOrNull(r.top_artist_count) } : null,
      topTrack: r.top_track ? splitTopTrack(String(r.top_track), toIntOrNull(r.top_track_count)) : null,
      topArtists: [],
      topTracks: [],
      first: null,
      last: null,
      shortGaps: null,
      verification: r.verification ? { status: String(r.verification) } : null,
      rangeKey: `${range.from}-${range.to}`,
      auditedAt: Date.parse(r.audited_at) || null,
    });
  }
  return finishRanking(range, entries, skipped);
}

function finishRanking(range, entries, skipped) {
  if (!entries.length) throw invalid('Não encontramos nenhum usuário no arquivo de ranking.');
  const warnings = skipped ? [`${skipped} linha(s) com problema foram ignoradas.`] : [];
  return { kind: 'ranking', ranking: { range, entries }, skipped, warnings };
}

function splitTopTrack(text, count) {
  const i = text.indexOf(' — ');
  return i === -1 ? { artist: '', track: text, count } : { artist: text.slice(0, i), track: text.slice(i + 3), count };
}

function normalizeRange(r, ctx) {
  if (!r) return null;
  const from = toInt(r.from);
  const to = toInt(r.to);
  if (!(from > 0) || !(to >= from)) return null;
  const timeZone = isValidTimeZone(r.timeZone) ? r.timeZone : ctx.fallbackTimeZone;
  const inclusiveEnd = r.inclusiveEnd !== false;
  const requestedTo = toInt(r.requestedTo) > 0 ? toInt(r.requestedTo) : inclusiveEnd ? to : to + 1;
  return {
    from,
    to,
    requestedTo,
    timeZone,
    inclusiveEnd,
    startInput: r.startInput || epochToInputValue(from, timeZone),
    endInput: r.endInput || epochToInputValue(requestedTo, timeZone),
    warnings: [],
  };
}

/* ---------------- util ---------------- */

function str(v) {
  return v == null ? '' : String(v);
}

function toInt(v) {
  if (v === '' || v == null) return NaN;
  const n = Number(v);
  return Number.isFinite(n) ? Math.trunc(n) : NaN;
}

function toIntOrNull(v) {
  const n = toInt(v);
  return Number.isFinite(n) ? n : null;
}

function invalid(message) {
  return new AppError(ErrorKind.INVALID_INPUT, message);
}
