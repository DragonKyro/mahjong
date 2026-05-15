import { Tile } from './Tile';

/** The three suits. Values are the single-letter codes used in toString(). */
export enum Suit {
  Character = 'm', // 萬
  Circle = 'p', // 筒
  Bamboo = 's', // 索
}

export type SuitRank = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9;

const SUIT_ORDER: Record<Suit, number> = {
  [Suit.Character]: 0,
  [Suit.Circle]: 1,
  [Suit.Bamboo]: 2,
};

/** Unicode mahjong code points for rank 1 of each suit. */
const UNICODE_BASE: Record<Suit, number> = {
  [Suit.Character]: 0x1f007, // 🀇 = m1
  [Suit.Circle]: 0x1f019, // 🀙 = p1
  [Suit.Bamboo]: 0x1f010, // 🀐 = s1
};

export class SuitTile extends Tile {
  readonly kind = 'suit' as const;

  constructor(
    readonly suit: Suit,
    readonly rank: SuitRank,
  ) {
    super();
  }

  toString(): string {
    return `${this.rank}${this.suit}`;
  }

  toUnicode(): string {
    return String.fromCodePoint(UNICODE_BASE[this.suit] + this.rank - 1);
  }

  equals(other: Tile): boolean {
    return other.isSuit() && other.suit === this.suit && other.rank === this.rank;
  }

  sortKey(): number {
    return SUIT_ORDER[this.suit] * 9 + (this.rank - 1);
  }

  override isTerminal(): boolean {
    return this.rank === 1 || this.rank === 9;
  }

  /** Ranks 2–8 — the "simples" (中張). */
  isSimple(): boolean {
    return !this.isTerminal();
  }
}
