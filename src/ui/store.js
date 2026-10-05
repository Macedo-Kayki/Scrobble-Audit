/** Store mínimo: estado imutável por substituição + assinantes. */
export function createStore(initial) {
  let state = initial;
  const subs = new Set();
  return {
    get: () => state,
    set(patch) {
      const prev = state;
      state = { ...state, ...(typeof patch === 'function' ? patch(state) : patch) };
      for (const fn of subs) fn(state, prev);
    },
    subscribe(fn) {
      subs.add(fn);
      return () => subs.delete(fn);
    },
  };
}

/** Memoiza por igualdade referencial dos argumentos. */
export function memo(fn) {
  let lastArgs = null;
  let last;
  return (...args) => {
    if (lastArgs && args.length === lastArgs.length && args.every((a, i) => a === lastArgs[i])) return last;
    lastArgs = args;
    last = fn(...args);
    return last;
  };
}
