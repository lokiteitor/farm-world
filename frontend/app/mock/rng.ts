// Deterministic pseudo random numbers for the simulated world.
//
// Owner: W3-C.
//
// `Math.random` is not used, and the reason is not the lint rule. A simulated server whose
// sample world differs between two reloads makes a component test of a panel unreproducible
// and makes a screenshot of a bug impossible to reproduce. The same seed has to produce the
// same farm, the same wear on the same tractor and the same three candidates in the pool.
//
// The generator is the same integer hash family as the terrain generator of shared/world,
// so the numbers here and the terrain the client generates come from one kind of
// arithmetic; it is not the same function, because this one is a sequence and that one is a
// spatial hash.

/** A named, reproducible sequence. */
export interface Rng {
  /** Next value in `[0, 1)`. */
  next: () => number;
  /** Integer in `[min, max]`, both included. */
  int: (min: number, max: number) => number;
  /** One element of a non empty list. */
  pick: <T>(values: readonly T[]) => T;
  /** True with the given probability. */
  chance: (probability: number) => boolean;
}

/** 32 bit integer mix. `Math.imul` keeps the multiplication in 32 bits. */
function mix32(value: number): number {
  let x = value | 0;
  x = Math.imul(x ^ (x >>> 16), 0x21f0aaad);
  x = Math.imul(x ^ (x >>> 15), 0x735a2d97);
  x ^= x >>> 15;
  return x >>> 0;
}

/** A sequence from a numeric seed. */
export function createRng(seed: number): Rng {
  let state = mix32(seed === 0 ? 0x9e3779b9 : seed) || 0x9e3779b9;

  const next = (): number => {
    state = mix32(state + 0x9e3779b9);
    return state / 0x1_0000_0000;
  };

  const int = (min: number, max: number): number => {
    if (max <= min) {
      return min;
    }
    return min + Math.floor(next() * (max - min + 1));
  };

  return {
    next,
    int,
    pick: <T>(values: readonly T[]): T => {
      const chosen = values[int(0, values.length - 1)];
      if (chosen === undefined) {
        throw new Error('No se puede elegir de una lista vacia.');
      }
      return chosen;
    },
    chance: (probability: number): boolean => next() < probability,
  };
}

/** A sequence from a text seed, so a fixture can be named rather than numbered. */
export function createNamedRng(name: string): Rng {
  let hash = 0x811c9dc5;
  for (let index = 0; index < name.length; index += 1) {
    hash = Math.imul(hash ^ name.charCodeAt(index), 0x01000193);
  }
  return createRng(hash >>> 0);
}
