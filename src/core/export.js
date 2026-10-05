import { APP } from '../config.js';
import { formatDateTime, toIsoUtc, toIsoZoned } from './time.js';
import { trackKey } from './model.js';

/**
 * Exportação CSV/JSON. Campos que a fonte não forneceu saem vazios (CSV) ou
 * null (JSON) — nunca preenchidos com suposições.
 */

export function scrobbleToRecord(s, { timeZone, username, durations }) {
  const ms = durations?.get(trackKey(s));
  return {
    source: s.source,
    username,
    timestamp_unix: s.ts,
    datetime_utc: toIsoUtc(s.ts),
    datetime_local: toIsoZoned(s.ts, timeZone),
    datetime_local_display: formatDateTime(s.ts, timeZone),
    timezone: timeZone,
    artist: s.artist,
    track: s.track,
    album: s.album || null,
    artist_mbid: s.artistMbid || null,
    track_mbid: s.trackMbid || null,
    album_mbid: s.albumMbid || null,
    duration_ms: ms ?? null,
    seconds_since_previous: s.gapPrev ?? null,
    url: s.url || null,
  };
}

export function csvEscape(value, delimiter) {
  if (value == null) return '';
  let s = String(value);
  // Evita injeção de fórmulas ao abrir no Excel/Sheets.
  if (/^[=+\-@\t\r]/.test(s) && typeof value === 'string') s = `'${s}`;
  return s.includes(delimiter) || /["\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCSV(records, { delimiter = ',' } = {}) {
  if (!records.length) return '﻿';
  const headers = Object.keys(records[0]);
  const lines = [headers.join(delimiter)];
  for (const r of records) lines.push(headers.map((h) => csvEscape(r[h], delimiter)).join(delimiter));
  return `﻿${lines.join('\r\n')}\r\n`; // BOM para o Excel reconhecer UTF-8
}

export function auditToJSON({ audit, scrobbles, filters, stats, timeZone, durations, scope }) {
  const username = audit.username;
  return JSON.stringify(
    {
      kind: 'scrobble-audit/audit',
      generator: { name: APP.name, version: APP.version },
      generatedAt: new Date().toISOString(),
      source: audit.source,
      username,
      range: {
        from_unix: audit.range.from,
        to_unix: audit.range.to,
        from_utc: toIsoUtc(audit.range.from),
        to_utc: toIsoUtc(audit.range.to),
        from_local: toIsoZoned(audit.range.from, audit.range.timeZone),
        to_local: toIsoZoned(audit.range.to, audit.range.timeZone),
        timezone: audit.range.timeZone,
        inclusive_end: audit.range.inclusiveEnd,
      },
      display_timezone: timeZone,
      scope, // 'filtered' | 'all'
      filters: scope === 'filtered' ? filters : null,
      verification: audit.verification,
      requests: audit.requests,
      fetched_at: new Date(audit.finishedAt).toISOString(),
      stats: stats && {
        total: stats.total,
        unique_tracks: stats.uniqueTracks,
        unique_artists: stats.uniqueArtists,
        unique_albums: stats.uniqueAlbums,
        top_tracks: stats.topTracks,
        top_artists: stats.topArtists,
        top_albums: stats.topAlbums,
        first_unix: stats.first,
        last_unix: stats.last,
      },
      scrobbles: scrobbles.map((s) => scrobbleToRecord(s, { timeZone, username, durations })),
    },
    null,
    2,
  );
}

export function rankingToRecords(rows, ranking) {
  return rows.map((r, i) => ({
    position: i + 1,
    username: r.username,
    source: r.source,
    scrobbles: r.total,
    unique_tracks: r.uniqueTracks,
    unique_artists: r.uniqueArtists,
    top_artist: r.topArtist?.artist ?? null,
    top_artist_count: r.topArtist?.count ?? null,
    top_track: r.topTrack ? `${r.topTrack.artist} — ${r.topTrack.track}` : null,
    top_track_count: r.topTrack?.count ?? null,
    verification: r.verification?.status ?? null,
    range_from_utc: toIsoUtc(ranking.range.from),
    range_to_utc: toIsoUtc(ranking.range.to),
    timezone: ranking.range.timeZone,
    audited_at: r.auditedAt ? new Date(r.auditedAt).toISOString() : null,
  }));
}

export function downloadFile(filename, content, mime) {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function safeFilename(...parts) {
  return parts
    .filter(Boolean)
    .join('_')
    .replace(/[^\w.-]+/g, '-')
    .replace(/-+/g, '-')
    .slice(0, 120);
}
