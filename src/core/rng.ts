// Seeded RNG (mulberry32). The engine never calls Math.random(): every shuffle
// draws from the uint32 state carried in the match state, so every device that
// replays the same seed + action log deals the same walls.

/** Advance `state` once; returns the next state and a float in [0, 1). */
export function nextRandom(state: number): [number, number] {
  const s = (state + 0x6d2b79f5) >>> 0;
  let t = s;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return [s, ((t ^ (t >>> 14)) >>> 0) / 4294967296];
}

/** A tiny mutable wrapper for code that draws several numbers in a row. */
export class Rng {
  constructor(public state: number) {
    this.state = state >>> 0;
  }
  next(): number {
    const [s, r] = nextRandom(this.state);
    this.state = s;
    return r;
  }
  int(n: number): number {
    return Math.floor(this.next() * n);
  }
  shuffle<T>(items: T[]): T[] {
    for (let i = items.length - 1; i > 0; i--) {
      const j = this.int(i + 1);
      [items[i], items[j]] = [items[j]!, items[i]!];
    }
    return items;
  }
}

/** A random 32-bit seed for a new match (UI side only; never inside the engine). */
export function freshSeed(): number {
  return (Math.random() * 4294967296) >>> 0;
}
