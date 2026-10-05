/**
 * Simulador da Last.fm user.getRecentTracks para testes.
 * Permite escolher a semântica de from/to e mutar os dados entre requisições.
 */
export function makeTrack(ts, artist, track, album = '') {
  return { ts, artist, track, album };
}

export class FakeLastfm {
  constructor(data, { fromInclusive = true, toInclusive = false, nowPlaying = null, onRequest } = {}) {
    this.data = [...data];
    this.fromInclusive = fromInclusive;
    this.toInclusive = toInclusive;
    this.nowPlaying = nowPlaying;
    this.onRequest = onRequest;
    this.requests = 0;
  }

  sorted() {
    // Ordem estável: ts desc; empate mantém ordem de inserção.
    return this.data.map((d, i) => ({ d, i })).sort((a, b) => b.d.ts - a.d.ts || a.i - b.i).map((x) => x.d);
  }

  window(from, to) {
    return this.sorted().filter((d) => (this.fromInclusive ? d.ts >= from : d.ts > from) && (this.toInclusive ? d.ts <= to : d.ts < to));
  }

  async getRecentTracks({ from, to, page = 1, limit = 200 }) {
    this.requests++;
    this.onRequest?.(this, this.requests);
    const all = this.window(from, to);
    const slice = all.slice((page - 1) * limit, page * limit);
    const tracks = slice.map((d) => ({
      artist: { '#text': d.artist, mbid: '' },
      name: d.track,
      album: { '#text': d.album, mbid: '' },
      date: { uts: String(d.ts), '#text': '' },
      url: '',
    }));
    if (this.nowPlaying && page === 1) {
      tracks.unshift({ artist: { '#text': 'NP' }, name: 'Now', album: { '#text': '' }, '@attr': { nowplaying: 'true' } });
    }
    return { tracks, total: all.length, totalPages: Math.max(1, Math.ceil(all.length / limit)) || 0, page, perPage: limit };
  }
}

/** Gera N scrobbles pseudo-aleatórios determinísticos dentro de [from, to]. */
export function generate(n, from, to, seed = 42) {
  let x = seed;
  const rnd = () => ((x = (x * 1103515245 + 12345) % 2147483648) / 2147483648);
  const out = [];
  for (let i = 0; i < n; i++) {
    const ts = from + Math.floor(rnd() * (to - from + 1));
    const a = Math.floor(rnd() * 30);
    out.push(makeTrack(ts, `Artist ${a}`, `Track ${a}-${Math.floor(rnd() * 15)}`, rnd() > 0.2 ? `Album ${a}` : ''));
  }
  return out;
}

/** Contagem esperada como multiconjunto "ts|artist|track|album". */
export function multiset(list) {
  const m = new Map();
  for (const s of list) {
    const k = `${s.ts}|${s.artist}|${s.track}|${s.album}`;
    m.set(k, (m.get(k) || 0) + 1);
  }
  return m;
}
