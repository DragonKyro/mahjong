import { Tile } from './Tile';

export type BonusCategory = 'flower' | 'season';
export type BonusIndex = 1 | 2 | 3 | 4;

/** 春夏秋冬 — also indexed 1–4 to match seat winds (東南西北). */
const SEASON_NAMES = ['Spring', 'Summer', 'Autumn', 'Winter'] as const;

/** 梅蘭菊竹 — also indexed 1–4 to match seat winds. */
const FLOWER_NAMES = ['Plum', 'Orchid', 'Chrysanthemum', 'Bamboo'] as const;

/** Unicode mahjong flower tiles, 0x1F022..0x1F025. */
const FLOWER_UNICODE = ['🀢', '🀣', '🀤', '🀥'] as const;

/** Unicode mahjong season tiles, 0x1F026..0x1F029. */
const SEASON_UNICODE = ['🀦', '🀧', '🀨', '🀩'] as const;

export class BonusTile extends Tile {
  readonly kind = 'bonus' as const;

  constructor(
    readonly category: BonusCategory,
    readonly index: BonusIndex,
  ) {
    super();
  }

  toString(): string {
    const tag = this.category === 'flower' ? 'F' : 'S';
    return `${tag}${this.index}`;
  }

  toUnicode(): string {
    const table = this.category === 'flower' ? FLOWER_UNICODE : SEASON_UNICODE;
    return table[this.index - 1]!;
  }

  /** Human-readable English name, e.g. "Plum", "Autumn". */
  name(): string {
    const table = this.category === 'flower' ? FLOWER_NAMES : SEASON_NAMES;
    return table[this.index - 1]!;
  }

  equals(other: Tile): boolean {
    return other.isBonus() && other.category === this.category && other.index === this.index;
  }

  sortKey(): number {
    const base = this.category === 'flower' ? 34 : 38;
    return base + (this.index - 1);
  }
}
