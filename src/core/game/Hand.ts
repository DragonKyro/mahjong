import type { Tile } from '@core/tiles/Tile';
import type { BonusTile } from '@core/tiles/BonusTile';
import type { Meld } from '@core/melds/Meld';

/**
 * A player's hand: concealed tiles still in the hand, melds that have been exposed
 * to opponents, and bonus tiles set aside (flowers/seasons score on their own).
 *
 * Concealed tiles are kept sorted by `Tile.compareTo` so callers can rely on
 * insertion order for display and shanten calculation.
 */
export class Hand {
  private readonly concealedTiles: Tile[] = [];
  private readonly exposedMelds: Meld[] = [];
  private readonly bonusTiles: BonusTile[] = [];

  /** Add a tile. Bonus tiles are auto-routed to the bonus pile. */
  add(tile: Tile): void {
    if (tile.isBonus()) {
      this.bonusTiles.push(tile);
      return;
    }
    const idx = this.concealedTiles.findIndex((t) => t.compareTo(tile) > 0);
    if (idx === -1) this.concealedTiles.push(tile);
    else this.concealedTiles.splice(idx, 0, tile);
  }

  /** Add many tiles at once (used on deal). */
  addAll(tiles: Iterable<Tile>): void {
    for (const t of tiles) this.add(t);
  }

  /**
   * Remove and return the first concealed tile that equals `tile`. Throws if no
   * matching tile is present. Bonus tiles are never removed once acquired.
   */
  remove(tile: Tile): Tile {
    const idx = this.concealedTiles.findIndex((t) => t.equals(tile));
    if (idx === -1) {
      throw new Error(`Tile ${tile.toString()} not in concealed hand`);
    }
    return this.concealedTiles.splice(idx, 1)[0]!;
  }

  /** True if at least one concealed tile equals `tile`. */
  has(tile: Tile): boolean {
    return this.concealedTiles.some((t) => t.equals(tile));
  }

  /** Number of concealed copies of `tile`. */
  countOf(tile: Tile): number {
    return this.concealedTiles.filter((t) => t.equals(tile)).length;
  }

  /** Expose a meld (after a successful pong/kong/chi claim or concealed kong declaration). */
  exposeMeld(meld: Meld): void {
    this.exposedMelds.push(meld);
  }

  get concealed(): readonly Tile[] {
    return this.concealedTiles;
  }

  get melds(): readonly Meld[] {
    return this.exposedMelds;
  }

  get bonuses(): readonly BonusTile[] {
    return this.bonusTiles;
  }

  /**
   * Total tile count toward the winning-hand size (14 on a winning turn).
   * Bonus tiles do not contribute. Each kong contributes 4 tiles in its meld,
   * but only 3 toward the 14-tile target (the extra is replaced by a draw),
   * so we count `meld.tiles.length - (kong ? 1 : 0)`.
   */
  size(): number {
    let melded = 0;
    for (const m of this.exposedMelds) {
      melded += m.type === 'kong' ? m.tiles.length - 1 : m.tiles.length;
    }
    return this.concealedTiles.length + melded;
  }
}
