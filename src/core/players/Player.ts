import { Hand } from '@core/game/Hand';
import type { Tile } from '@core/tiles/Tile';
import type { Wind } from '@core/tiles/HonorTile';

/**
 * A seat at the table. Owns its hand, its discard pile, and its running score.
 * Concrete subclasses (HumanPlayer, AIPlayer) differ only in how decisions are
 * made — those abstract methods will be added in Phase 2 when the turn loop
 * needs them.
 */
export abstract class Player {
  readonly hand = new Hand();
  readonly discards: Tile[] = [];
  score = 0;

  constructor(
    readonly name: string,
    readonly seatWind: Wind,
  ) {}

  /** Append a tile to this player's discard pool. */
  recordDiscard(tile: Tile): void {
    this.discards.push(tile);
  }
}
