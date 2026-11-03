/** An inclusive `[min, max]` range. Every timing option in wraith takes one, in milliseconds. */
export type Range = readonly [min: number, max: number];

export interface Rng {
  /** Uniform float in [0, 1). */
  next(): number;
  /** Uniform float in [min, max). */
  float(min: number, max: number): number;
  /** Uniform integer in [min, max]. */
  int(min: number, max: number): number;
  /** True with probability `p`. */
  chance(p: number): boolean;
  /** Normally distributed value. */
  gaussian(mean?: number, stdDev?: number): number;
  /**
   * A value from `range`, weighted toward the middle (triangular distribution). People rarely
   * hit the extremes of their own timing, so this looks more natural than a uniform pick.
   */
  inRange(range: Range): number;
  pick<T>(items: readonly T[]): T;
}

/** Small, fast seeded PRNG. Good enough for jitter; not for anything security-related. */
function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A random source. Pass a seed to make every delay, path and typo reproducible. */
export function createRng(seed?: number): Rng {
  const next = seed === undefined ? Math.random : mulberry32(seed);
  return {
    next,
    float: (min, max) => min + next() * (max - min),
    int: (min, max) => Math.floor(min + next() * (max - min + 1)),
    chance: (p) => p > 0 && next() < p,
    gaussian(mean = 0, stdDev = 1) {
      // Box-Muller. 1 - next() keeps the log argument above zero.
      const u = 1 - next();
      const v = next();
      return mean + stdDev * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
    },
    inRange([min, max]) {
      if (max <= min) return min;
      return min + ((next() + next()) / 2) * (max - min);
    },
    pick(items) {
      if (items.length === 0) throw new RangeError('pick() needs at least one item');
      return items[Math.floor(next() * items.length)]!;
    },
  };
}

export const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, Math.max(0, ms)));
