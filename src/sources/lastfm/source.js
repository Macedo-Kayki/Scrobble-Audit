import { LASTFM, AUDIT } from '../../config.js';
import { AppError, ErrorKind, throwIfAborted } from '../../core/errors.js';
import { ScrobbleCollector } from '../../core/model.js';
import { defaultSleep } from '../../core/rateLimiter.js';
import { LastfmClient } from './client.js';

/**
 * Fonte de scrobbles Last.fm.
 *
 * ESTRATÉGIA DE BUSCA EXATA POR INTERVALO
 * ---------------------------------------
 * 1. Janela com folga de 1s: consultamos (from-1, to+1) e filtramos o
 *    intervalo exato no cliente. Assim o resultado é correto quer a API trate
 *    `from`/`to` como inclusivos ou exclusivos.
 * 2. Sonda: a 1ª página informa o total oficial (`@attr.total`) da janela.
 * 3. Paginação por CURSOR DE TEMPO, não por número de página: cada requisição
 *    pede `to = (timestamp mais antigo visto) + 1`. Scrobbles novos que
 *    chegam durante a auditoria (inclusive scrobbles offline com data
 *    retroativa) não deslocam páginas, então nada é pulado. O segundo de
 *    fronteira é relido de propósito e deduplicado pelo `ScrobbleCollector`,
 *    que preserva duplicatas legítimas.
 * 4. Se um único segundo tiver ≥ 200 scrobbles (importações), esse segundo
 *    é paginado por número de página isoladamente.
 * 5. Para grandes volumes o intervalo é dividido em fatias de tempo
 *    disjuntas, percorridas em paralelo (respeitando o rate limit global).
 * 6. Verificação: ao final, a contagem coletada é comparada com um novo
 *    `@attr.total`. Se faltar algo, roda passadas de reconciliação.
 *
 * Bordas externas (início e fim da janela) usam exatamente os mesmos
 * parâmetros da sonda, para que a contagem seja comparável ao total oficial.
 */
export function createLastfmSource({ getApiKey, proxyUrl = LASTFM.proxyUrl, fetchImpl, sleep = defaultSleep, limiter } = {}) {
  let client = null;
  let clientId = null;

  /**
   * Key própria do usuário (Configurações) tem prioridade; sem ela, usa o
   * proxy da instância, que guarda a key no servidor.
   */
  function getClient() {
    const key = (getApiKey?.() || '').trim();
    const opts = key ? { apiKey: key } : proxyUrl ? { proxyUrl } : null;
    if (!opts) throw new AppError(ErrorKind.MISSING_API_KEY);
    const id = key ? `key:${key}` : `proxy:${proxyUrl}`;
    if (!client || clientId !== id) {
      client = new LastfmClient({ ...opts, fetchImpl, sleep, limiter });
      clientId = id;
    }
    return client;
  }

  return {
    id: 'lastfm',
    name: 'Last.fm',
    homepage: 'https://www.last.fm',
    usesProxy: () => Boolean(proxyUrl) && !(getApiKey?.() || '').trim(),
    hasCredentials: () => Boolean(proxyUrl || (getApiKey?.() || '').trim()),
    capabilities: { userInfo: true, trackDuration: true },
    profileUrl: (username) => `https://www.last.fm/user/${encodeURIComponent(username)}`,

    async getUser(username, { signal } = {}) {
      const u = await getClient().getUserInfo(username, { signal });
      return normalizeUser(u);
    },

    async countScrobbles({ user, from, to, signal }) {
      const res = await getClient().getRecentTracks({ user, from: from - 1, to: to + 1, page: 1, limit: 1 }, { signal });
      return res.total;
    },

    async getTrackDuration({ artist, track }, { signal } = {}) {
      try {
        const t = await getClient().getTrackInfo({ artist, track }, { signal });
        const ms = parseInt(t?.duration, 10);
        return Number.isFinite(ms) && ms > 0 ? ms : null; // 0 = desconhecida
      } catch (e) {
        if (e.kind === ErrorKind.INVALID_INPUT) return null;
        throw e;
      }
    },

    /**
     * Busca todos os scrobbles com from <= ts <= to (segundos, inclusivo).
     * @returns {Promise<{ scrobbles: import('../../core/model.js').Scrobble[], verification: object, requests: number, retries: number }>}
     */
    async fetchScrobbles({ user, from, to, signal, onProgress = () => {}, confirmLarge }) {
      const c = getClient();
      const req0 = c.requestCount;
      const retry0 = c.retryCount;
      const fetcher = new RangeFetcher({ client: c, user, from, to, signal, sleep, onProgress });
      const result = await fetcher.run({ confirmLarge });
      return { ...result, requests: c.requestCount - req0, retries: c.retryCount - retry0 };
    },
  };
}

export class RangeFetcher {
  constructor({ client, user, from, to, signal, sleep = defaultSleep, onProgress = () => {}, limit = LASTFM.pageLimit, concurrency = LASTFM.concurrency }) {
    if (!Number.isInteger(from) || !Number.isInteger(to) || from > to) {
      throw new AppError(ErrorKind.INVALID_INPUT, 'Intervalo inválido: o início deve ser anterior ao fim.');
    }
    this.client = client;
    this.user = user;
    this.from = from;
    this.to = to;
    this.qFrom = from - 1;
    this.qTo = to + 1;
    this.signal = signal;
    this.sleep = sleep;
    this.onProgress = onProgress;
    this.limit = limit;
    this.concurrency = concurrency;
    this.collector = new ScrobbleCollector();
    this.expected = 0;
    this.nowPlayingSeen = false;
  }

  progress(phase, extra = {}) {
    this.onProgress({ phase, fetched: this.collector.size, expected: this.expected, ...extra });
  }

  async run({ confirmLarge } = {}) {
    this.progress('probe');
    const first = await this.page({ from: this.qFrom, to: this.qTo });
    this.expected = first.total;
    const firstItems = this.normalize(first.tracks);
    this.collector.addBatch(firstItems);
    this.progress('fetch');

    if (first.totalPages > 1) {
      if (confirmLarge && this.expected > AUDIT.largeAuditThreshold) {
        const ok = await confirmLarge({ expected: this.expected, estimatedRequests: Math.ceil(this.expected / this.limit) + 2 });
        if (!ok) throw new AppError(ErrorKind.ABORTED, 'Auditoria cancelada antes do download completo.');
      }
      if (!firstItems.length) throw new AppError(ErrorKind.INCONSISTENT, 'A primeira página veio vazia apesar de haver resultados.');
      // Restante: [qFrom, c] — inclui o segundo `c` para completar o que transbordou da 1ª página.
      const c = Math.min(...firstItems.map((s) => s.ts));
      await this.walkSlices(this.makeSlices(this.qFrom, c, this.expected - firstItems.length));
    }

    // Verificação + reconciliação
    let verification = await this.verify();
    let passes = 0;
    while (verification.status === 'missing' && passes < AUDIT.reconciliationPasses) {
      passes++;
      this.progress('reconcile', { pass: passes });
      await this.walk({ lo: this.qFrom, hi: this.qTo, outerLow: true, outerHigh: true });
      verification = await this.verify();
    }
    verification.reconciliationPasses = passes;

    const scrobbles = this.collector.toArray().filter((s) => s.ts >= this.from && s.ts <= this.to);
    this.progress('done', { inRange: scrobbles.length });
    return { scrobbles, verification };
  }

  async verify() {
    this.progress('verify');
    const res = await this.page({ from: this.qFrom, to: this.qTo, limit: 1 });
    const expected = res.total;
    const fetched = this.collector.size;
    // Se a API incluir o "now playing" no total, aceitamos a diferença de 1.
    const tolerance = this.nowPlayingSeen ? 1 : 0;
    let status = 'verified';
    if (fetched < expected - tolerance) status = 'missing';
    else if (fetched > expected) status = 'extra';
    return {
      status,
      expected,
      initialExpected: this.expected,
      fetchedInWindow: fetched,
      queryWindow: { from: this.qFrom, to: this.qTo },
      nowPlayingSeen: this.nowPlayingSeen,
      changedDuringAudit: expected !== this.expected,
    };
  }

  /** Divide [lo, hi] em fatias de tempo disjuntas para paralelizar. */
  makeSlices(lo, hi, remainingEstimate) {
    const n = remainingEstimate <= this.limit * 2 ? 1 : Math.min(100, Math.max(this.concurrency, Math.ceil(remainingEstimate / 2000)));
    const span = hi - lo + 1;
    const count = Math.max(1, Math.min(n, span));
    const slices = [];
    for (let i = 0; i < count; i++) {
      const sLo = lo + Math.floor((span * i) / count);
      const sHi = lo + Math.floor((span * (i + 1)) / count) - 1;
      slices.push({ lo: sLo, hi: sHi, outerLow: i === 0, outerHigh: false });
    }
    return slices.reverse(); // mais recentes primeiro
  }

  async walkSlices(slices) {
    const queue = [...slices];
    const workers = Array.from({ length: Math.min(this.concurrency, queue.length) }, async () => {
      while (queue.length) {
        throwIfAborted(this.signal);
        await this.walk(queue.shift());
      }
    });
    await Promise.all(workers);
  }

  /**
   * Percorre uma fatia [lo, hi] por cursor de tempo, do mais novo ao mais antigo.
   * Bordas "outer" usam os mesmos parâmetros da sonda (sem filtro local).
   */
  async walk({ lo, hi, outerLow, outerHigh }) {
    let top = hi;
    let isOuterHigh = outerHigh;
    let emptyRetries = 0;
    const qFrom = outerLow ? this.qFrom : lo - 1;
    const minTs = outerLow ? -Infinity : lo;

    for (;;) {
      throwIfAborted(this.signal);
      const res = await this.page({ from: qFrom, to: isOuterHigh ? this.qTo : top + 1 });
      const raw = this.normalize(res.tracks);
      const maxTs = isOuterHigh ? Infinity : top;
      this.collector.addBatch(raw.filter((s) => s.ts >= minTs && s.ts <= maxTs));
      this.progress('fetch');

      if (res.totalPages <= 1) return; // última página desta janela
      if (!raw.length) {
        if (++emptyRetries > 3) throw new AppError(ErrorKind.INCONSISTENT, 'Página vazia recorrente durante a paginação.');
        await this.sleep(1000 * emptyRetries, this.signal);
        continue;
      }
      emptyRetries = 0;
      const oldest = Math.min(...raw.map((s) => s.ts));
      if (!isOuterHigh && oldest >= top) {
        // Página inteira dentro do mesmo segundo: pagina esse segundo isoladamente.
        await this.fetchWholeSecond(top);
        top -= 1;
      } else {
        top = oldest;
      }
      isOuterHigh = false;
      if (!outerLow && top < lo) return;
    }
  }

  /** Busca todos os scrobbles de um único segundo por número de página. */
  async fetchWholeSecond(ts) {
    const all = [];
    let page = 1;
    let totalPages = 1;
    do {
      const res = await this.page({ from: ts - 1, to: ts + 1, page });
      totalPages = res.totalPages;
      all.push(...this.normalize(res.tracks).filter((s) => s.ts === ts));
      page++;
    } while (page <= totalPages);
    this.collector.addBatch(all); // um único lote, para a multiplicidade ficar exata
  }

  page({ from, to, page = 1, limit = this.limit }) {
    return this.client.getRecentTracks({ user: this.user, from, to, page, limit }, { signal: this.signal });
  }

  normalize(tracks) {
    const out = [];
    for (const t of tracks) {
      const s = normalizeTrack(t);
      if (s) out.push(s);
      else this.nowPlayingSeen = true;
    }
    return out;
  }
}

/** Item cru de recenttracks -> Scrobble. Retorna null para "now playing". */
export function normalizeTrack(t) {
  const uts = parseInt(t?.date?.uts, 10);
  if (t?.['@attr']?.nowplaying === 'true' || !Number.isFinite(uts)) return null;
  return {
    id: '',
    source: 'lastfm',
    ts: uts,
    artist: text(t.artist),
    track: String(t.name ?? ''),
    album: text(t.album),
    artistMbid: t.artist?.mbid || '',
    trackMbid: t.mbid || '',
    albumMbid: t.album?.mbid || '',
    url: t.url || '',
    image: pickImage(t.image),
  };
}

function text(v) {
  if (v == null) return '';
  if (typeof v === 'string') return v;
  return String(v['#text'] ?? v.name ?? '');
}

function pickImage(images) {
  if (!Array.isArray(images)) return '';
  const byPref = ['medium', 'large', 'small', 'extralarge'];
  for (const size of byPref) {
    const img = images.find((i) => i.size === size && i['#text']);
    if (img) return img['#text'];
  }
  return '';
}

function normalizeUser(u) {
  if (!u) throw new AppError(ErrorKind.USER_NOT_FOUND);
  const registered = parseInt(u.registered?.unixtime ?? u.registered?.['#text'], 10);
  return {
    username: u.name,
    realName: u.realname || '',
    url: u.url || '',
    image: pickImage(u.image),
    playcount: u.playcount != null ? parseInt(u.playcount, 10) : null,
    registeredTs: Number.isFinite(registered) ? registered : null,
    country: u.country && u.country !== 'None' ? u.country : '',
  };
}
