import { Wind, SEAT_ORDER } from '@core/tiles/HonorTile';
import type { RulesConfig } from './RulesConfig';

/** Per-seat score deltas from a single round. Positive = gain, negative = loss. */
export type ScoreDeltas = Map<Wind, number>;

/**
 * HK Old Style payout schedule. Base unit doubles per faan starting at minFaan = 1 unit,
 * capped at limitFaan units.
 *
 *   3 faan = 1u, 4 = 2u, 5 = 4u, 6 = 8u, 7 = 16u, 8 = 32u, 9 = 64u, 10 = 128u,
 *   11 = 256u, 12 = 512u, 13+ = 1024u (limit hand).
 *
 * Payout rules:
 *   - 自摸 (self-draw): each of the three non-winners pays the winner `unit` each;
 *     winner receives `3 * unit`.
 *   - 放炮 (discard): the discarder pays the winner `unit`; other seats pay nothing.
 *
 * This implementation intentionally omits the dealer-double common in some HK
 * variants — Phase 3 keeps the table minimal so it can be tightened later in a
 * dedicated scoring pass.
 */
export class ScoreTable {
  constructor(private readonly config: RulesConfig) {}

  /** Compute the unit value for a given faan total (clamped to config bounds). */
  unitFor(faan: number): number {
    const clamped = Math.max(this.config.minFaan, Math.min(faan, this.config.limitFaan));
    const stepsAboveMin = clamped - this.config.minFaan;
    return this.config.baseUnit * 2 ** stepsAboveMin;
  }

  scoreWin(opts: {
    faan: number;
    winnerSeat: Wind;
    fromSeat: Wind | null;
  }): ScoreDeltas {
    const deltas: ScoreDeltas = new Map(SEAT_ORDER.map((w) => [w, 0]));
    const unit = this.unitFor(opts.faan);
    if (opts.fromSeat === null) {
      // Self-draw: each loser pays `unit`.
      for (const w of SEAT_ORDER) {
        if (w === opts.winnerSeat) continue;
        deltas.set(w, -unit);
        deltas.set(opts.winnerSeat, (deltas.get(opts.winnerSeat) ?? 0) + unit);
      }
    } else {
      deltas.set(opts.fromSeat, -unit);
      deltas.set(opts.winnerSeat, unit);
    }
    return deltas;
  }
}
