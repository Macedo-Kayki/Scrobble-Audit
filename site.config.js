// Configuração PÚBLICA desta instância. Pode ser commitada: não contém segredos.
// A API key da Last.fm NUNCA vai aqui — ela fica no servidor do proxy
// (variável LASTFM_API_KEY na Vercel, ou arquivo .env para o servidor.py local).
window.SCROBBLE_AUDIT_CONFIG = {
  // Proxy que acrescenta a key no servidor. '/api/lastfm' funciona tanto na
  // Vercel (api/lastfm.js) quanto localmente (servidor.py).
  // Use '' para hospedagem 100% estática sem proxy: cada usuário informa a
  // própria key em Configurações.
  proxyUrl: '/api/lastfm',
};
