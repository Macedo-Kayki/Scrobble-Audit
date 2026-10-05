import { LASTFM } from '../../config.js';
import { AppError, ErrorKind, throwIfAborted } from '../../core/errors.js';
import { RateLimiter, defaultSleep } from '../../core/rateLimiter.js';

/**
 * Cliente HTTP da Last.fm API (somente métodos públicos, sem autenticação).
 * Responsável por: montar URLs, limitar taxa, retentar erros transitórios e
 * mapear erros da API para `AppError`.
 *
 * Dois modos:
 *  - `proxyUrl`: chama o proxy SEM api_key (a key é acrescentada no servidor);
 *  - `apiKey`:  chama a Last.fm direto com a key informada pelo próprio usuário.
 *
 * Códigos da Last.fm: https://www.last.fm/api/errorcodes
 */
const RETRYABLE_CODES = new Set([8, 11, 16, 29]);

export class LastfmClient {
  /**
   * @param {{ apiKey?: string, proxyUrl?: string, fetchImpl?: typeof fetch, limiter?: RateLimiter,
   *           sleep?: typeof defaultSleep, maxRetries?: number, baseUrl?: string,
   *           timeoutMs?: number }} opts
   */
  constructor({ apiKey = '', proxyUrl = '', fetchImpl, limiter, sleep = defaultSleep, maxRetries = LASTFM.maxRetries, baseUrl = LASTFM.baseUrl, timeoutMs = LASTFM.requestTimeoutMs }) {
    this.apiKey = apiKey;
    this.proxyUrl = proxyUrl;
    this.fetchImpl = fetchImpl || ((...a) => fetch(...a));
    this.limiter = limiter || new RateLimiter({ minIntervalMs: LASTFM.minRequestIntervalMs, concurrency: LASTFM.concurrency });
    this.sleep = sleep;
    this.maxRetries = maxRetries;
    this.baseUrl = baseUrl;
    this.timeoutMs = timeoutMs;
    this.requestCount = 0;
    this.retryCount = 0;
  }

  async call(method, params = {}, { signal } = {}) {
    if (!this.proxyUrl && !this.apiKey) throw new AppError(ErrorKind.MISSING_API_KEY);
    const base = typeof location !== 'undefined' ? location.href : 'http://localhost/';
    const url = new URL(this.proxyUrl || this.baseUrl, base);
    url.searchParams.set('method', method);
    for (const [k, v] of Object.entries(params)) {
      if (v !== undefined && v !== null && v !== '') url.searchParams.set(k, String(v));
    }
    if (!this.proxyUrl) {
      url.searchParams.set('api_key', this.apiKey);
      url.searchParams.set('format', 'json');
    }

    let lastError;
    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      throwIfAborted(signal);
      try {
        return await this.limiter.run(() => this.#request(url, signal), signal);
      } catch (err) {
        if (err.kind === ErrorKind.ABORTED || !err.retryable || attempt === this.maxRetries) throw err;
        lastError = err;
        this.retryCount++;
        const base = err.kind === ErrorKind.RATE_LIMITED ? 5000 : 800;
        const wait = Math.min(60000, base * 2 ** attempt) + Math.random() * 400;
        if (err.kind === ErrorKind.RATE_LIMITED) this.limiter.pause(wait);
        await this.sleep(wait, signal);
      }
    }
    throw lastError;
  }

  async #request(url, signal) {
    this.requestCount++;
    const ctrl = new AbortController();
    const onAbort = () => ctrl.abort();
    signal?.addEventListener('abort', onAbort, { once: true });
    const timer = setTimeout(() => ctrl.abort('timeout'), this.timeoutMs);
    let res;
    try {
      res = await this.fetchImpl(url.toString(), { signal: ctrl.signal, headers: { Accept: 'application/json' } });
    } catch (cause) {
      if (signal?.aborted) throw new AppError(ErrorKind.ABORTED);
      if (ctrl.signal.aborted) throw new AppError(ErrorKind.TIMEOUT, undefined, { retryable: true, cause });
      throw new AppError(ErrorKind.NETWORK, undefined, { retryable: true, cause });
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
    }

    let body = null;
    try {
      body = await res.json();
    } catch {
      body = null;
    }

    if (body && typeof body.error === 'number') throw mapApiError(body.error, body.message);
    if (this.proxyUrl && res.status === 404 && !body) {
      throw new AppError(ErrorKind.UNAVAILABLE, 'O site não conseguiu se conectar à Last.fm. Se você instalou o site, confira a configuração; ou coloque sua própria chave de acesso em Configurações.', { code: 404 });
    }
    if (res.status === 429) throw new AppError(ErrorKind.RATE_LIMITED, undefined, { code: 429, retryable: true });
    if (res.status >= 500) throw new AppError(ErrorKind.UNAVAILABLE, undefined, { code: res.status, retryable: true });
    if (!res.ok) throw new AppError(ErrorKind.UNKNOWN, `A Last.fm respondeu com um erro (código ${res.status}). Tente de novo.`, { code: res.status });
    if (!body) throw new AppError(ErrorKind.UNAVAILABLE, 'A Last.fm enviou uma resposta que não deu para ler. Tente de novo.', { retryable: true });
    return body;
  }

  // ---------- Métodos ----------

  /**
   * user.getRecentTracks normalizado.
   * @returns {Promise<{ tracks: RawTrack[], total: number, totalPages: number, page: number, perPage: number }>}
   */
  async getRecentTracks({ user, from, to, page = 1, limit = LASTFM.pageLimit }, opts) {
    const body = await this.call('user.getrecenttracks', { user, from, to, page, limit, extended: 0 }, opts);
    const rt = body.recenttracks;
    if (!rt) throw new AppError(ErrorKind.INCONSISTENT, undefined, { retryable: true });
    const attr = rt['@attr'] || {};
    let list = rt.track || [];
    if (!Array.isArray(list)) list = [list]; // a API retorna objeto quando há 1 item
    return {
      tracks: list,
      total: toInt(attr.total),
      totalPages: toInt(attr.totalPages),
      page: toInt(attr.page),
      perPage: toInt(attr.perPage),
    };
  }

  async getUserInfo(user, opts) {
    const body = await this.call('user.getinfo', { user }, opts);
    return body.user;
  }

  async getTrackInfo({ artist, track }, opts) {
    const body = await this.call('track.getinfo', { artist, track, autocorrect: 0 }, opts);
    return body.track;
  }
}

function toInt(v) {
  const n = parseInt(v, 10);
  return Number.isFinite(n) ? n : 0;
}

export function mapApiError(code, message = '') {
  const msg = String(message);
  switch (code) {
    case 6:
      if (/user not found/i.test(msg)) return new AppError(ErrorKind.USER_NOT_FOUND, undefined, { code });
      if (/track not found/i.test(msg)) return new AppError(ErrorKind.INVALID_INPUT, 'Música não encontrada na Last.fm.', { code });
      return new AppError(ErrorKind.INVALID_INPUT, 'A Last.fm não aceitou a consulta. Confira os campos.', { code });
    case 10:
    case 26:
      // O proxy usa o código 10 quando o servidor está sem LASTFM_API_KEY.
      return new AppError(ErrorKind.INVALID_API_KEY, /LASTFM_API_KEY/.test(msg) ? msg : undefined, { code });
    case 17:
      return new AppError(ErrorKind.PRIVATE_PROFILE, undefined, { code });
    case 29:
      return new AppError(ErrorKind.RATE_LIMITED, undefined, { code, retryable: true });
    case 11:
    case 16:
      return new AppError(ErrorKind.UNAVAILABLE, undefined, { code, retryable: true });
    case 8:
      return new AppError(ErrorKind.UNAVAILABLE, 'A Last.fm teve um problema ao responder. Tente de novo.', { code, retryable: true });
    default:
      return new AppError(ErrorKind.UNKNOWN, `A Last.fm respondeu com um erro (código ${code}). Tente de novo.`, { code, retryable: RETRYABLE_CODES.has(code) });
  }
}

/**
 * @typedef {Object} RawTrack  item cru de recenttracks.track
 * @property {{ '#text': string, mbid?: string }} artist
 * @property {string} name
 * @property {{ '#text': string, mbid?: string }} album
 * @property {{ uts: string, '#text': string }} [date]
 * @property {{ nowplaying?: string }} [@attr]
 */
