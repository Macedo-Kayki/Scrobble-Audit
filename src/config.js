/**
 * Configuração estática da aplicação.
 *
 * Valores que o usuário pode alterar (timezone etc.) ficam no localStorage via
 * `core/storage.js`. Aqui ficam apenas defaults e constantes.
 *
 * A configuração pública da instância vem de `site.config.js`
 * (`window.SCROBBLE_AUDIT_CONFIG`). Ela NÃO aceita API key: a key fica no proxy
 * (`api/lastfm.js` na Vercel ou `servidor.py` localmente), para nunca chegar ao navegador.
 */
const injected = (typeof window !== 'undefined' && window.SCROBBLE_AUDIT_CONFIG) || {};
if (injected.lastfmApiKey) {
  console.warn('[Scrobble Audit] lastfmApiKey em SCROBBLE_AUDIT_CONFIG é ignorada: ela ficaria visível no navegador. Configure a key no proxy (veja o README).');
}

export const APP = Object.freeze({
  name: 'Scrobble Audit',
  version: '1.0.0',
  repoUrl: injected.repoUrl || '',
});

export const LASTFM = Object.freeze({
  baseUrl: 'https://ws.audioscrobbler.com/2.0/',
  /** Proxy que acrescenta a API key no servidor. Vazio = chamadas diretas com a key do usuário. */
  proxyUrl: String(injected.proxyUrl || '').trim(),
  /** Máximo aceito por user.getRecentTracks. */
  pageLimit: 200,
  /**
   * A Last.fm pede para não exceder ~5 req/s na média. Usamos uma margem.
   * Intervalo mínimo entre o início de duas requisições, em ms.
   */
  minRequestIntervalMs: 250,
  /** Requisições simultâneas no máximo. */
  concurrency: 3,
  maxRetries: 6,
  /** Timeout por requisição, em ms. */
  requestTimeoutMs: 30000,
});

export const AUDIT = Object.freeze({
  /** Acima disso pedimos confirmação antes de baixar tudo. */
  largeAuditThreshold: 20000,
  /** Quantas passadas extras de reconciliação tentar se a verificação falhar. */
  reconciliationPasses: 2,
  /** Intervalo entre scrobbles abaixo do qual o par é sinalizado (segundos). */
  shortGapSeconds: 30,
});

/**
 * Fuso horário único do app: todos os horários são digitados e exibidos no
 * horário de Brasília. Para outra região, troque aqui (nome IANA).
 */
export const TIME_ZONE = 'America/Sao_Paulo';
export const TIME_ZONE_LABEL = 'horário de Brasília';

export const DEFAULT_SETTINGS = Object.freeze({
  source: 'lastfm',
  apiKey: '',
  inclusiveEnd: true,
  csvDelimiter: ';', // Excel em português
  pageSize: 100,
  theme: 'auto', // auto | light | dark
});
