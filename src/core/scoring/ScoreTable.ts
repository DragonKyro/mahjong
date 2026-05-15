import { Wind, SEAT_ORDER } from '@core/tiles/HonorTile';
import type { RulesConfig } from './RulesConfig';

/** Per-seat score deltas from a single round. Positive = gain, negative = loss. */
export type ScoreDeltas = Map<Wind, number>;

/**
 * HK Old Style payout schedule. Base unit doubles per faan starting at minFaan = 1 unit,
 * capped at limitFaan units:
 *
 *   3 faan = 1u, 4 = 2u, 5 = 4u, 6 = 8u, 7 = 16u, 8 = 32u, 9 = 64u, 10 = 128u,
 *   11 = 256u, 12 = 512u, 13+ = 1024u (limit hand).
 *
 * Settlement (`V = unitFor(faan)`):
 *
 *   - 自摸 (self-draw): every loser pays `V` to the winner.
 *   - 食糊 (discard): the discarder pays `2V`; the other two losers pay `V` each.
 *
 * Dealer doubling (`config.dealerDoubling`, default true): each individual payment
 * is multiplied by 2 if the dealer is the receiver (winner === dealer), and by 2
 * again if the payer is the dealer. The two multipliers stack independently — a
 * dealer self-drawing collects `2V` from every loser; a non-dealer winning on the
 * dealer's discard collects `4V` from the dealer (`2V` discarder × 2 dealer) plus
 * `V` from each of the other two losers.
 *
 * References: Wikipedia "Hong Kong mahjong scoring rules"; Mahjong Wiki
 * "Hong Kong Old Style Scoring".
 */
export class ScoreTable {
  constructor(private readonly config: RulesConfig) {}

  /** Compute the unit value `V` for a given faan total (clamped to config bounds). */
  unitFor(faan: number): number {
    const clamped = Math.max(this.config.minFaan, Math.min(faan, this.config.limitFaan));
    const stepsAboveMin = clamped - this.config.minFaan;
    return this.config.baseUnit * 2 ** stepsAboveMin;
  }

  scoreWin(opts: {
    faan: number;
    winnerSeat: Wind;
    /** null = self-draw (自摸); else the seat that fed the winning tile (放炮). */
    fromSeat: Wind | null;
    dealer: Wind;
  }): ScoreDeltas {
    const deltas: ScoreDeltas = new Map(SEAT_ORDER.map((w) => [w, 0]));
    const V = this.unitFor(opts.faan);
    const winnerDouble = this.config.dealerDoubling && opts.winnerSeat === opts.dealer ? 2 : 1;

    for (const loser of SEAT_ORDER) {
      if (loser === opts.winnerSeat) continue;
      const baseShare = opts.fromSeat !== null && loser === opts.fromSeat ? 2 * V : V;
      const loserDouble = this.config.dealerDoubling && loser === opts.dealer ? 2 : 1;
      const payment = baseShare * winnerDouble * loserDouble;
      deltas.set(loser, (deltas.get(loser) ?? 0) - payment);
      deltas.set(opts.winnerSeat, (deltas.get(opts.winnerSeat) ?? 0) + payment);
    }
    return deltas;
  }
}
