import { Tile } from './Tile';

/** The four winds (風牌). Values are single-letter codes used in toString(). */
export enum Wind {
  East = 'E', // 東
  South = 'S', // 南
  West = 'W', // 西
  North = 'N', // 北
}

/** The three dragons (元牌). C = 中 (red), F = 發 (green), P = 白 (white plate). */
export enum Dragon {
  Red = 'C',
  Green = 'F',
  White = 'P',
}

export type Honor = Wind | Dragon;

const HONOR_ORDER: Record<Honor, number> = {
  [Wind.East]: 27,
  [Wind.South]: 28,
  [Wind.West]: 29,
  [Wind.North]: 30,
  [Dragon.Red]: 31,
  [Dragon.Green]: 32,
  [Dragon.White]: 33,
};

const HONOR_UNICODE: Record<Honor, string> = {
  [Wind.East]: '🀀',
  [Wind.South]: '🀁',
  [Wind.West]: '🀂',
  [Wind.North]: '🀃',
  [Dragon.Red]: '🀄',
  [Dragon.Green]: '🀅',
  [Dragon.White]: '🀆',
};

const WIND_SET: ReadonlySet<Honor> = new Set([Wind.East, Wind.South, Wind.West, Wind.North]);

/** Seat order around the table (East -> South -> West -> North -> East). */
export const SEAT_ORDER: readonly Wind[] = [Wind.East, Wind.South, Wind.West, Wind.North];

/** The 下家 of `w` — the player who plays immediately after `w`. */
export function nextWind(w: Wind): Wind {
  const i = SEAT_ORDER.indexOf(w);
  return SEAT_ORDER[(i + 1) % 4]!;
}

/** The 上家 of `w` — the player who plays immediately before `w`. */
export function prevWind(w: Wind): Wind {
  const i = SEAT_ORDER.indexOf(w);
  return SEAT_ORDER[(i + 3) % 4]!;
}

export class HonorTile extends Tile {
  readonly kind = 'honor' as const;

  constructor(readonly honor: Honor) {
    super();
  }

  toString(): string {
    return this.honor;
  }

  toUnicode(): string {
    return HONOR_UNICODE[this.honor];
  }

  equals(other: Tile): boolean {
    return other.isHonor() && other.honor === this.honor;
  }

  sortKey(): number {
    return HONOR_ORDER[this.honor];
  }

  isWind(): boolean {
    return WIND_SET.has(this.honor);
  }

  isDragon(): boolean {
    return !this.isWind();
  }
}
