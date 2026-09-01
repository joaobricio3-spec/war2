export interface Rng {
  /** Inclusive integer range. */
  nextInt(min: number, max: number): number;
  shuffle<T>(items: T[]): T[];
}

/** Deterministic LCG for tests and seeded games. */
export function createSeededRng(seed: number): Rng {
  let s = seed >>> 0;
  const next = () => {
    s = (Math.imul(1664525, s) + 1013904223) >>> 0;
    return s;
  };
  const rng: Rng = {
    nextInt(min, max) {
      if (max < min) throw new Error("rng: max < min");
      const span = max - min + 1;
      return min + (next() % span);
    },
    shuffle<T>(items: T[]) {
      const copy = [...items];
      for (let i = copy.length - 1; i > 0; i--) {
        const j = rng.nextInt(0, i);
        [copy[i], copy[j]] = [copy[j]!, copy[i]!];
      }
      return copy;
    },
  };
  return rng;
}

export function rollDie(rng: Rng): number {
  return rng.nextInt(1, 6);
}

export function rollDice(rng: Rng, count: number): number[] {
  return Array.from({ length: count }, () => rollDie(rng));
}
