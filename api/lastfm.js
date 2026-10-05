/**
 * Proxy da Last.fm API — Vercel Function servida em /api/lastfm.
 *
 * A API key fica na variável de ambiente LASTFM_API_KEY do projeto na Vercel
 * e nunca é enviada ao navegador: o app chama /api/lastfm?method=... sem key,
 * e esta função acrescenta a key antes de repassar à Last.fm.
 *
 * Regras (as mesmas do servidor.py, usado localmente):
 *  - só métodos de leitura usados pelo app;
 *  - só parâmetros conhecidos (qualquer api_key vinda do cliente é descartada);
 *  - sem cabeçalhos CORS e recusa requisições cross-site do navegador, para
 *    que outros sites não usem este proxy (e a sua cota) pelo navegador.
 */
const LASTFM_URL = 'https://ws.audioscrobbler.com/2.0/';
const ALLOWED_METHODS = new Set(['user.getrecenttracks', 'user.getinfo', 'track.getinfo']);
const ALLOWED_PARAMS = new Set(['user', 'from', 'to', 'page', 'limit', 'extended', 'artist', 'track', 'autocorrect', 'mbid']);
const TIMEOUT_MS = 25000;

export function GET(request) {
  return handle(request, process.env);
}

/** Separado de GET para ser testável com um `env` simulado. */
export async function handle(request, env) {
  const site = request.headers.get('sec-fetch-site');
  if (site && site !== 'same-origin' && site !== 'none') {
    return json({ error: 4, message: 'Uso do proxy a partir de outro site não é permitido.' }, 403);
  }

  const url = new URL(request.url);
  const method = (url.searchParams.get('method') || '').toLowerCase();
  if (!ALLOWED_METHODS.has(method)) return json({ error: 3, message: 'Método não permitido pelo proxy.' }, 400);

  const key = String(env.LASTFM_API_KEY || '').trim();
  if (!key) return json({ error: 10, message: 'Proxy sem LASTFM_API_KEY configurada no servidor.' }, 500);

  const upstream = new URL(LASTFM_URL);
  for (const [k, v] of url.searchParams) if (ALLOWED_PARAMS.has(k)) upstream.searchParams.set(k, v);
  upstream.searchParams.set('method', method);
  upstream.searchParams.set('api_key', key);
  upstream.searchParams.set('format', 'json');

  let res;
  try {
    res = await fetch(upstream, {
      headers: { Accept: 'application/json', 'User-Agent': 'ScrobbleAudit-Proxy/1.0' },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch {
    return json({ error: 11, message: 'Falha ao contatar a Last.fm.' }, 502);
  }
  return new Response(await res.text(), {
    status: res.status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
  });
}

function json(obj, status) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
  });
}
