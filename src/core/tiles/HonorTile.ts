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
