import type { PlayerPolicy } from '@core/players/PlayerPolicy';
import type { Tile } from '@core/tiles/Tile';
import type { Wind } from '@core/tiles/HonorTile';
import type { TurnAction, Claim, PlayerView } from '@core/game/types';
import type { RNG } from '@utils/rng';
import { mulberry32 } from '@utils/rng';

/**
 * Beginner-difficulty AI: discards a random concealed (non-bonus) tile and
 * passes on every claim. Useful as a sanity baseline and as the easiest tier.
 *
 * Constructor takes an optional seeded RNG so behavior can be reproduced in
 * tests; without a seed, falls back to a non-deterministic mulberry32.
 */
export class RandomAI implements PlayerPolicy {
  private readonly rng: RNG;

  constructor(rng?: RNG) {
    this.rng = rng ?? mulberry32((Math.random() * 1e9) >>> 0);
  }

  chooseAction(view: PlayerView, _drawn: Tile | null): TurnAction {
    const candidates = view.self.hand.filter((t) => !t.isBonus());
    if (candidates.length === 0) {
      throw new Error('RandomAI.chooseAction: no non-bonus tiles in hand');
    }
    const idx = Math.floor(this.rng() * candidates.length);
    return { kind: 'discard', tile: candidates[idx]! };
  }

  chooseClaim(_v: PlayerView, _d: Tile, _f: Wind, _options: readonly Claim[]): Claim {
    return { kind: 'pass' };
  }
}
