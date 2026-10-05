import { test } from 'node:test';
import assert from 'node:assert/strict';
import { handle } from '../api/lastfm.js';
import { LastfmClient } from '../src/sources/lastfm/client.js';
import { createLastfmSource } from '../src/sources/lastfm/source.js';
import { RateLimiter } from '../src/core/rateLimiter.js';

const SECRET = 'segredo-do-servidor-1234';
const okBody = { user: { name: 'rj' } };

/** Substitui o fetch global (chamada à Last.fm) durante o teste. */
function withUpstream(fn) {
  return async () => {
    const calls = [];
    const real = globalThis.fetch;
    globalThis.fetch = async (url) => {
      calls.push(String(url));
      return new Response(JSON.stringify(okBody), { status: 200, headers: { 'Content-Type': 'application/json' } });
    };
    try {
      await fn(calls);
    } finally {
      globalThis.fetch = real;
    }
  };
}

const req = (qs, headers = {}) => new Request(`https://app.test/api/lastfm?${qs}`, { headers });

test(
  'proxy acrescenta a key no servidor, descarta a do cliente e nunca a devolve',
  withUpstream(async (calls) => {
    const res = await handle(req('method=user.getinfo&user=rj&api_key=TENTATIVA&callback=x', { 'Sec-Fetch-Site': 'same-origin' }), { LASTFM_API_KEY: SECRET });
    assert.equal(res.status, 200);
    assert.ok(!(await res.text()).includes(SECRET), 'a key não pode voltar ao cliente');
    assert.equal(res.headers.get('Access-Control-Allow-Origin'), null, 'sem CORS: outros sites não leem as respostas');
    const upstream = new URL(calls[0]);
    assert.equal(upstream.searchParams.get('api_key'), SECRET);
    assert.equal(upstream.searchParams.get('method'), 'user.getinfo');
    assert.equal(upstream.searchParams.has('callback'), false, 'parâmetros desconhecidos são descartados');
  }),
);

test(
  'proxy bloqueia métodos fora da lista, uso cross-site e ausência de key',
  withUpstream(async (calls) => {
    const env = { LASTFM_API_KEY: SECRET };
    assert.equal((await handle(req('method=auth.getsession'), env)).status, 400);
    assert.equal((await handle(req('method=user.getinfo&user=rj', { 'Sec-Fetch-Site': 'cross-site' }), env)).status, 403);
    const noKey = await handle(req('method=user.getinfo&user=rj'), {});
    assert.equal(noKey.status, 500);
    assert.equal((await noKey.json()).error, 10);
    assert.equal(calls.length, 0, 'nenhuma dessas requisições chega à Last.fm');
  }),
);

test('cliente em modo proxy não envia api_key', async () => {
  const urls = [];
  const fetchImpl = async (url) => {
    urls.push(url);
    return { status: 200, ok: true, json: async () => okBody };
  };
  const limiter = new RateLimiter({ minIntervalMs: 0, sleep: async () => {} });
  const c = new LastfmClient({ proxyUrl: 'https://app.test/api/lastfm', fetchImpl, limiter, sleep: async () => {} });
  await c.getUserInfo('rj');
  const u = new URL(urls[0]);
  assert.equal(u.origin + u.pathname, 'https://app.test/api/lastfm');
  assert.equal(u.searchParams.has('api_key'), false);
  assert.equal(u.searchParams.get('method'), 'user.getinfo');
});

test('cliente explica quando o proxy não existe (hospedagem estática)', async () => {
  const limiter = new RateLimiter({ minIntervalMs: 0, sleep: async () => {} });
  const fetchImpl = async () => ({ status: 404, ok: false, json: async () => Promise.reject(new Error('html')) });
  const c = new LastfmClient({ proxyUrl: '/api/lastfm', fetchImpl, limiter, sleep: async () => {} });
  await assert.rejects(c.getUserInfo('rj'), (e) => /não conseguiu se conectar/.test(e.message));
});

test('fonte: key própria tem prioridade; sem ela usa o proxy; sem nenhum exige configuração', async () => {
  const urls = [];
  const fetchImpl = async (url) => {
    urls.push(new URL(url));
    return { status: 200, ok: true, json: async () => okBody };
  };
  const limiter = new RateLimiter({ minIntervalMs: 0, sleep: async () => {} });
  let key = '';
  const src = createLastfmSource({ getApiKey: () => key, proxyUrl: 'https://app.test/api/lastfm', fetchImpl, limiter, sleep: async () => {} });
  await src.getUser('rj');
  assert.equal(urls[0].hostname, 'app.test');
  assert.equal(src.usesProxy(), true);
  key = 'minha-key';
  await src.getUser('rj');
  assert.equal(urls[1].hostname, 'ws.audioscrobbler.com');
  assert.equal(urls[1].searchParams.get('api_key'), 'minha-key');

  const none = createLastfmSource({ getApiKey: () => '', proxyUrl: '', fetchImpl, limiter });
  assert.equal(none.hasCredentials(), false);
  await assert.rejects(none.getUser('rj'), (e) => e.kind === 'missing_api_key');
});
