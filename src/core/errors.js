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
  user_not_found: 'Não encontramos esse usuário na Last.fm. Confira se o nome está certo.',
  private_profile: 'Este usuário deixou o histórico de músicas privado, então não dá para auditar.',
  invalid_api_key: 'A chave de acesso da Last.fm não funcionou. Confira em Configurações.',
  missing_api_key: 'Falta a chave de acesso da Last.fm. Abra Configurações para colocar a sua.',
  rate_limited: 'A Last.fm está recebendo pedidos demais agora. Espere alguns minutos e tente de novo.',
  unavailable: 'A Last.fm não está respondendo agora. Tente de novo daqui a pouco.',
  network: 'Sem conexão com a internet. Confira sua conexão e tente de novo.',
  timeout: 'A Last.fm demorou demais para responder. Tente de novo.',
  invalid_input: 'Confira os campos preenchidos.',
  inconsistent_response: 'A Last.fm enviou uma resposta incompleta. Tente de novo.',
  aborted: 'Operação cancelada.',
  unknown: 'Algo deu errado. Tente de novo.',
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
