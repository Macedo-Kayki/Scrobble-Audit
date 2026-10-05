import { AppError, ErrorKind } from './errors.js';

/**
 * Limitador simples: garante um intervalo mínimo entre o início de requisições
 * e um teto de requisições simultâneas. Compartilhado por todos os workers de
 * uma mesma fonte, para respeitar o limite global da API.
 */
export class RateLimiter {
  constructor({ minIntervalMs = 250, concurrency = 3, now = () => Date.now(), sleep = defaultSleep } = {}) {
    this.minIntervalMs = minIntervalMs;
    this.concurrency = concurrency;
    this.now = now;
    this.sleep = sleep;
    this.active = 0;
    this.nextSlot = 0;
    this.waiters = [];
    this.pausedUntil = 0;
  }

  /** Pausa global (ex.: após erro de rate limit), em ms a partir de agora. */
  pause(ms) {
    this.pausedUntil = Math.max(this.pausedUntil, this.now() + ms);
  }

  /** Executa `fn` respeitando os limites. */
  async run(fn, signal) {
    await this.#acquire(signal);
    try {
      return await fn();
    } finally {
      this.active--;
      const next = this.waiters.shift();
      if (next) next();
    }
  }

  async #acquire(signal) {
    while (this.active >= this.concurrency) {
      await new Promise((resolve) => this.waiters.push(resolve));
    }
    this.active++;
    try {
      // Reserva um "slot" de tempo antes de dormir, para workers concorrentes
      // não pegarem o mesmo instante.
      const t = this.now();
      const slot = Math.max(t, this.nextSlot, this.pausedUntil);
      this.nextSlot = slot + this.minIntervalMs;
      if (slot > t) await this.sleep(slot - t, signal);
    } catch (e) {
      this.active--;
      const next = this.waiters.shift();
      if (next) next();
      throw e;
    }
  }
}

export function defaultSleep(ms, signal) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(new AppError(ErrorKind.ABORTED));
    const id = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    function onAbort() {
      clearTimeout(id);
      reject(new AppError(ErrorKind.ABORTED));
    }
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}
