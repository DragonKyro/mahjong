import { Tile } from '@core/tiles/Tile';
import { Wall } from '@core/tiles/Wall';
import type { RNG } from '@utils/rng';
import { mulberry32 } from '@utils/rng';
import { Ukeire, type DiscardAnalysis } from './Ukeire';

export interface Puzzle {
  /** Stable id for progress tracking — derived from the hand contents. */
  id: string;
  /** The 14-tile hand the user discards from. Always non-bonus tiles. */
  hand: Tile[];
  /** Pre-computed analysis for every distinct discard candidate. */
  analyses: DiscardAnalysis[];
  /** The single best discard per `Ukeire.optimalDiscard`. */
  optimal: DiscardAnalysis;
  /** Minimum shanten across all candidate discards. -1 means the 14-tile hand is already winning. */
  bestShanten: number;
}

export interface GenerateOpts {
  rng?: RNG;
  /**
   * Stop early once we find a hand with bestShanten <= this. Defaults to 1
   * (tenpai or 1-shanten — the most educational range).
   */
  preferredMaxShanten?: number;
  /** How many random walls to try before giving up. Defaults to 30. */
  maxAttempts?: number;
}

/**
 * Random-puzzle source for the training mode. Builds shuffled walls until it
 * lands on a hand at or below `preferredMaxShanten`; if no attempt qualifies,
 * returns the lowest-shanten hand seen.
 *
 * Bonus tiles are filtered out at deal time so puzzles always involve a clean
 * 14-tile concealed hand with no exposed melds.
 */
export class PuzzleGenerator {
  static generate(opts: GenerateOpts = {}): Puzzle {
    const rng: RNG = opts.rng ?? mulberry32((Math.random() * 1e9) >>> 0);
    const preferredMax = opts.preferredMaxShanten ?? 1;
    const maxAttempts = opts.maxAttempts ?? 30;
    let best: Puzzle | null = null;
    for (let i = 0; i < maxAttempts; i++) {
      const puzzle = buildOne(rng);
      if (puzzle.bestShanten <= preferredMax) return puzzle;
      if (best === null || puzzle.bestShanten < best.bestShanten) best = puzzle;
    }
    return best ?? buildOne(rng);
  }
}

function buildOne(rng: RNG): Puzzle {
  const wall = new Wall(rng);
  const hand: Tile[] = [];
  while (hand.length < 14 && wall.liveRemaining() > 0) {
    const t = wall.draw();
    if (!t.isBonus()) hand.push(t);
  }
  // Sort the hand for a stable display order.
  hand.sort((a, b) => a.compareTo(b));
  const analyses = Ukeire.analyzeAll(hand, 0, hand);
  const optimal = Ukeire.optimalDiscard(analyses);
  const bestShanten = analyses.reduce((m, a) => Math.min(m, a.shanten), 8);
  const id = hand.map((t) => t.toString()).join('|');
  return { id, hand, analyses, optimal, bestShanten };
}
