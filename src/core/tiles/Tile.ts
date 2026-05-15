import type { SuitTile } from './SuitTile';
import type { HonorTile } from './HonorTile';
import type { BonusTile } from './BonusTile';

export type TileKind = 'suit' | 'honor' | 'bonus';

/**
 * Abstract base for every tile in the wall. Each subclass owns its own identifying
 * fields (suit+rank, honor enum, bonus category+index). All tiles share a canonical
 * `sortKey` that defines a total order across the full 144-tile set.
 */
export abstract class Tile {
  abstract readonly kind: TileKind;

  /** Short ASCII code used in logs and tests, e.g. "3m", "E", "F1". */
  abstract toString(): string;

  /** Unicode mahjong glyph for display, e.g. "🀉", "🀀". */
  abstract toUnicode(): string;

  /** Two tiles are equal iff they represent the same conceptual tile-type. */
  abstract equals(other: Tile): boolean;

  /** Position in the canonical sort: 0–26 suits, 27–33 honors, 34–41 bonuses. */
  abstract sortKey(): number;

  compareTo(other: Tile): number {
    return this.sortKey() - other.sortKey();
  }

  isSuit(): this is SuitTile {
    return this.kind === 'suit';
  }

  isHonor(): this is HonorTile {
    return this.kind === 'honor';
  }

  isBonus(): this is BonusTile {
    return this.kind === 'bonus';
  }

  /** 1 or 9 of a suit (邊張-eligible). Overridden by SuitTile; default false. */
  isTerminal(): boolean {
    return false;
  }

  /** Terminal or honor — never part of a chi sequence (么九). */
  isTerminalOrHonor(): boolean {
    return this.isHonor() || this.isTerminal();
  }
}
