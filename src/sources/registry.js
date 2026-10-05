/**
 * Registro de fontes de scrobbles.
 *
 * Toda fonte implementa a interface abaixo. Para adicionar uma nova fonte
 * (ex.: ListenBrainz, Libre.fm, Maloja), crie `src/sources/<id>/source.js`
 * retornando um objeto com este formato e registre-o em `main.js`.
 *
 * @typedef {Object} ScrobbleSource
 * @property {string} id
 * @property {string} name
 * @property {string} [homepage]
 * @property {{ userInfo?: boolean, trackDuration?: boolean }} capabilities
 * @property {(username: string) => string} profileUrl
 * @property {(username: string, opts?: { signal?: AbortSignal }) => Promise<UserInfo>} getUser
 * @property {(args: { user: string, from: number, to: number, signal?: AbortSignal }) => Promise<number>} countScrobbles
 * @property {(args: { user: string, from: number, to: number, signal?: AbortSignal,
 *             onProgress?: (p: object) => void,
 *             confirmLarge?: (info: { expected: number, estimatedRequests: number }) => Promise<boolean> })
 *             => Promise<{ scrobbles: import('../core/model.js').Scrobble[], verification: Verification, requests: number, retries: number }>} fetchScrobbles
 *   Deve retornar TODOS os scrobbles com from <= ts <= to (segundos, inclusivo), newest-first.
 * @property {(args: { artist: string, track: string }, opts?: { signal?: AbortSignal }) => Promise<number|null>} [getTrackDuration]
 *
 * @typedef {Object} UserInfo
 * @property {string} username   grafia canônica
 * @property {string} realName
 * @property {string} url
 * @property {string} image
 * @property {number|null} playcount
 * @property {number|null} registeredTs
 * @property {string} country
 *
 * @typedef {Object} Verification
 * @property {'verified'|'missing'|'extra'|'unverifiable'} status
 * @property {number} expected        total informado pela fonte
 * @property {number} fetchedInWindow total coletado
 */
const sources = new Map();

export function registerSource(source) {
  for (const k of ['id', 'name', 'getUser', 'fetchScrobbles']) {
    if (!source?.[k]) throw new Error(`Fonte inválida: campo "${k}" ausente.`);
  }
  sources.set(source.id, source);
}

export function getSource(id) {
  const s = sources.get(id);
  if (!s) throw new Error(`Fonte de scrobbles desconhecida: ${id}`);
  return s;
}

export function listSources() {
  return [...sources.values()];
}
