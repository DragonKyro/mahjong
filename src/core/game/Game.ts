import { Wall } from '@core/tiles/Wall';
import { Wind, nextWind } from '@core/tiles/HonorTile';
import { Round, type SeatedPlayers } from './Round';
import type { RoundOutcome } from './types';
import type { RNG } from '@utils/rng';

/**
 * Multi-round match controller. Owns the prevailing wind, the dealer rotation,
 * and the running scoreboard. A `Game` does not own a wall — each round
 * receives a fresh `Wall(rng)` so the host's RNG can be re-seeded between
 * rounds in multiplayer if needed.
 *
 * Phase 2 dealer rule (simplification of HK Old Style):
 *   - Dealer (莊) retains (連莊) if they win the round, either by self-draw or
 *     by claiming someone else's discard.
 *   - Otherwise the dealer position rotates East -> South -> West -> North.
 *   - The prevailing wind advances when the dealer cycles back to East.
 */
export class Game {
  readonly players: SeatedPlayers;
  private _prevailingWind: Wind;
  private _dealer: Wind;
  readonly history: RoundOutcome[] = [];

  constructor(
    players: SeatedPlayers,
    opts?: { prevailingWind?: Wind; dealer?: Wind },
  ) {
    if (players[0].seatWind !== Wind.East) {
      throw new Error('Game expects players in [East, South, West, North] order');
    }
    this.players = players;
    this._prevailingWind = opts?.prevailingWind ?? Wind.East;
    this._dealer = opts?.dealer ?? Wind.East;
  }

  get prevailingWind(): Wind {
    return this._prevailingWind;
  }

  get dealer(): Wind {
    return this._dealer;
  }

  /** Play one round to completion. The caller supplies a (possibly seeded) RNG for the wall. */
  playRound(rng: RNG): RoundOutcome {
    const wall = new Wall(rng);
    const round = new Round(this.players, wall, this._prevailingWind, this._dealer);
    const outcome = round.play();
    this.history.push(outcome);
    this.advanceDealer(outcome);
    return outcome;
  }

  private advanceDealer(outcome: RoundOutcome): void {
    if (outcome.kind === 'win' && outcome.winner === this._dealer) {
      return; // 連莊 — dealer retains.
    }
    this._dealer = nextWind(this._dealer);
    if (this._dealer === Wind.East) {
      this._prevailingWind = nextWind(this._prevailingWind);
    }
  }
}
