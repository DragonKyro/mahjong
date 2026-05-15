export type RNG = () => number;

/**
 * Mulberry32 — deterministic 32-bit PRNG. Same seed produces the same sequence,
 * which is required for replayable training scenarios and host-verifiable
 * multiplayer shuffles. Output is in [0, 1).
 */
export function mulberry32(seed: number): RNG {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Fisher–Yates shuffle in place, using the provided RNG. Returns the same array. */
export function shuffleInPlace<T>(arr: T[], rng: RNG): T[] {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [arr[i], arr[j]] = [arr[j]!, arr[i]!];
  }
  return arr;
}
