import { AppError, ErrorKind } from './errors.js';
import { annotateGaps } from './model.js';
import { parseDateTimeInput, zonedToEpoch, isValidTimeZone, formatDateTime } from './time.js';

/**
 * Converte os campos do formulário (wall time no timezone escolhido) em um
 * intervalo de timestamps Unix.
 *
 * @returns {{ from: number, to: number, requestedTo: number, timeZone: string,
 *             inclusiveEnd: boolean, startInput: string, endInput: string, warnings: string[] }}
 */
export function buildRange({ startInput, endInput, timeZone, inclusiveEnd = true }) {
  if (!isValidTimeZone(timeZone)) throw new AppError(ErrorKind.INVALID_INPUT, 'Fuso horário inválido.');
  const sp = parseDateTimeInput(startInput);
  const ep = parseDateTimeInput(endInput);
  if (!sp) throw new AppError(ErrorKind.INVALID_INPUT, 'Preencha a data e a hora de início.');
  if (!ep) throw new AppError(ErrorKind.INVALID_INPUT, 'Preencha a data e a hora de fim.');
  const s = zonedToEpoch(sp, timeZone);
  const e = zonedToEpoch(ep, timeZone);
  const warnings = [];
  if (!s.valid) warnings.push('O horário de início não existe por causa do horário de verão. Usamos o horário válido logo depois.');
  if (!e.valid) warnings.push('O horário de fim não existe por causa do horário de verão. Usamos o horário válido logo depois.');
  const from = Math.floor(s.epochMs / 1000);
  const requestedTo = Math.floor(e.epochMs / 1000);
  const to = inclusiveEnd ? requestedTo : requestedTo - 1;
  if (to < from) throw new AppError(ErrorKind.INVALID_INPUT, 'O fim precisa ser depois do início.');
  const nowSec = Math.floor(Date.now() / 1000);
  if (from > nowSec) warnings.push('Esse período começa no futuro, então ainda não há scrobbles.');
  return { from, to, requestedTo, timeZone, inclusiveEnd, startInput, endInput, warnings };
}

/** Chave canônica de um intervalo (para comparar auditorias/ranking). */
export function rangeKey(range) {
  return `${range.from}-${range.to}`;
}

export function describeRange(range, tz = range.timeZone) {
  return `${formatDateTime(range.from, tz)} → ${formatDateTime(range.requestedTo ?? range.to, tz)}`;
}

/**
 * Executa uma auditoria completa: valida usuário, baixa e verifica scrobbles.
 *
 * @param {{ source: import('../sources/registry.js').ScrobbleSource, username: string,
 *           range: ReturnType<typeof buildRange>, signal?: AbortSignal,
 *           onProgress?: (p: object) => void, confirmLarge?: Function }} args
 */
export async function runAudit({ source, username, range, signal, onProgress = () => {}, confirmLarge }) {
  const name = String(username || '').trim();
  if (!name) throw new AppError(ErrorKind.INVALID_INPUT, 'Digite o nome de usuário da Last.fm.');
  const startedAt = Date.now();

  onProgress({ phase: 'user' });
  const user = await source.getUser(name, { signal });

  const { scrobbles, verification, requests, retries } = await source.fetchScrobbles({
    user: user.username || name,
    from: range.from,
    to: range.to,
    signal,
    onProgress,
    confirmLarge,
  });

  annotateGaps(scrobbles);
  const finishedAt = Date.now();
  return {
    id: `${source.id}:${(user.username || name).toLowerCase()}:${rangeKey(range)}:${finishedAt}`,
    source: source.id,
    sourceName: source.name,
    username: user.username || name,
    user,
    range: { ...range },
    scrobbles,
    verification,
    requests: requests + 1, // + getUser
    retries,
    startedAt,
    finishedAt,
    durationMs: finishedAt - startedAt,
  };
}
