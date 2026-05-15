import { Wall } from '@core/tiles/Wall';
import { Wind, nextWind, SEAT_ORDER } from '@core/tiles/HonorTile';
import { Round, type SeatedPlayers } from './Round';
import type { RoundOutcome } from './types';
import type { RNG } from '@utils/rng';
import type { WinValidator } from '@core/scoring/WinValidator';
import { HKOldStyleWinValidator } from '@core/scoring/HKOldStyleWinValidator';
import { FaanCalculator } from '@core/scoring/FaanCalculator';
import { ScoreTable } from '@core/scoring/ScoreTable';
import { DEFAULT_RULES, type RulesConfig } from '@core/scoring/RulesConfig';

/**
 * Multi-round match controller. Owns the prevailing wind, the dealer rotation,
 * the running scoreboard, and the scoring stack (validator + faan calculator +
 * score table). A `Game` does not own a wall — each round receives a fresh
 * `Wall(rng)` so the host's RNG can be re-seeded between rounds in multiplayer.
 *
 * Dealer rule (simplification of HK Old Style):
 *   - Dealer retains (連莊) if they win.
 *   - Otherwise the dealer rotates East -> South -> West -> North.
 *   - The prevailing wind advances when the dealer cycles back to East.
 */
export class Game {
  readonly players: SeatedPlayers;
  readonly rules: RulesConfig;
  readonly winValidator: WinValidator;
  readonly faanCalculator: FaanCalculator;
  readonly scoreTable: ScoreTable;
  private _prevailingWind: Wind;
  private _dealer: Wind;
  readonly history: RoundOutcome[] = [];

  readonly onTurnEnd: (() => void | Promise<void>) | undefined;

  constructor(
    players: SeatedPlayers,
    opts?: {
      prevailingWind?: Wind;
      dealer?: Wind;
      rules?: RulesConfig;
      winValidator?: WinValidator;
      /** Forwarded to every `Round` this game creates — runs after each turn. */
      onTurnEnd?: () => void | Promise<void>;
    },
  ) {
    if (players[0].seatWind !== Wind.East) {
      throw new Error('Game expects players in [East, South, West, North] order');
    }
    this.players = players;
    this.rules = opts?.rules ?? DEFAULT_RULES;
    this.faanCalculator = new FaanCalculator(this.rules);
    this.scoreTable = new ScoreTable(this.rules);
    this.winValidator = opts?.winValidator ?? new HKOldStyleWinValidator(this.rules);
    this.onTurnEnd = opts?.onTurnEnd;
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
  async playRound(rng: RNG): Promise<RoundOutcome> {
    const wall = new Wall(rng);
    const round = new Round(this.players, wall, this._prevailingWind, this._dealer, {
      winValidator: this.winValidator,
      faanCalculator: this.faanCalculator,
      ...(this.onTurnEnd ? { onTurnEnd: this.onTurnEnd } : {}),
    });
    const outcome = await round.play();
    this.history.push(outcome);
    if (outcome.kind === 'win' && outcome.faan) {
      this.applyScoring(outcome);
    }
    this.advanceDealer(outcome);
    return outcome;
  }

  private applyScoring(outcome: Extract<RoundOutcome, { kind: 'win' }>): void {
    if (!outcome.faan) return;
    const deltas = this.scoreTable.scoreWin({
      faan: outcome.faan.total,
      winnerSeat: outcome.winner,
      fromSeat: outcome.from,
      dealer: this._dealer,
    });
    for (const w of SEAT_ORDER) {
      const idx = SEAT_ORDER.indexOf(w);
      const player = this.players[idx];
      if (player) player.score += deltas.get(w) ?? 0;
    }
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
