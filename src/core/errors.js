/**
 * Erros normalizados. Fontes de scrobbles (Last.fm e futuras) devem converter
 * seus erros para `AppError` com um `kind` desta lista, para que a UI trate
 * todos de forma uniforme.
 */
export const ErrorKind = Object.freeze({
  USER_NOT_FOUND: 'user_not_found',
  PRIVATE_PROFILE: 'private_profile',
  INVALID_API_KEY: 'invalid_api_key',
  MISSING_API_KEY: 'missing_api_key',
  RATE_LIMITED: 'rate_limited',
  UNAVAILABLE: 'unavailable',
  NETWORK: 'network',
  TIMEOUT: 'timeout',
  INVALID_INPUT: 'invalid_input',
  INCONSISTENT: 'inconsistent_response',
  ABORTED: 'aborted',
  UNKNOWN: 'unknown',
});

const MESSAGES = {
  user_not_found: 'Usuário não encontrado. Confira o username.',
  private_profile: 'Este usuário mantém o histórico de scrobbles privado.',
  invalid_api_key: 'API key inválida ou suspensa. Revise em Configurações.',
  missing_api_key: 'Configure sua API key da Last.fm em Configurações para começar.',
  rate_limited: 'Limite de requisições da API atingido. Aguarde alguns minutos e tente de novo.',
  unavailable: 'A API está indisponível no momento. Tente novamente mais tarde.',
  network: 'Falha de rede. Verifique sua conexão.',
  timeout: 'A API demorou demais para responder.',
  invalid_input: 'Parâmetros inválidos.',
  inconsistent_response: 'A API retornou dados inconsistentes durante a paginação.',
  aborted: 'Operação cancelada.',
  unknown: 'Erro inesperado.',
};

export class AppError extends Error {
  /**
   * @param {string} kind  um valor de ErrorKind
   * @param {string} [message]
   * @param {{ code?: number|string, retryable?: boolean, cause?: unknown, detail?: string }} [extra]
   */
  constructor(kind, message, extra = {}) {
    super(message || MESSAGES[kind] || MESSAGES.unknown);
    this.name = 'AppError';
    this.kind = kind;
    this.code = extra.code;
    this.retryable = Boolean(extra.retryable);
    this.detail = extra.detail;
    if (extra.cause) this.cause = extra.cause;
  }
}

export function friendlyMessage(err) {
  if (err instanceof AppError) return err.message;
  if (err?.name === 'AbortError') return MESSAGES.aborted;
  return err?.message || MESSAGES.unknown;
}

export function isAbort(err) {
  return err?.kind === ErrorKind.ABORTED || err?.name === 'AbortError';
}

export function throwIfAborted(signal) {
  if (signal?.aborted) throw new AppError(ErrorKind.ABORTED);
}
