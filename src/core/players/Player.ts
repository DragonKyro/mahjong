import { Hand } from '@core/game/Hand';
import type { Tile } from '@core/tiles/Tile';
import type { Wind } from '@core/tiles/HonorTile';
import type { PlayerPolicy } from './PlayerPolicy';

/**
 * A seat at the table. Owns its hand, its discard pile, its running score, and
 * the `PlayerPolicy` that decides this seat's moves. Concrete subclasses are
 * thin — the variation between human, AI, and remote players lives in the
 * injected policy, not in the class hierarchy.
 */
export abstract class Player {
  readonly hand = new Hand();
  readonly discards: Tile[] = [];
  score = 0;

  constructor(
    readonly name: string,
    readonly seatWind: Wind,
    readonly policy: PlayerPolicy,
  ) {}

  /** Append a tile to this player's discard pool. */
  recordDiscard(tile: Tile): void {
    this.discards.push(tile);
  }

  /** Clear hand and discards for a fresh round. Score (cross-round bankroll) is preserved. */
  resetForRound(): void {
    this.hand.reset();
    this.discards.length = 0;
  }
}
