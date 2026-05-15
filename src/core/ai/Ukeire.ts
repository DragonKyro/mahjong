import { Tile } from '@core/tiles/Tile';
import { Shanten, indexToTile, tileToIndex, countTiles } from '@core/ai/Shanten';

const NUM_TILE_TYPES = 34;

export interface WaitTile {
  /** Tile that would improve shanten if drawn. */
  tile: Tile;
  /** How many copies remain unseen (4 minus visible occurrences). */
  remaining: number;
}

export interface DiscardAnalysis {
  /** The candidate tile to discard from the 14-tile hand. */
  discard: Tile;
  /** Resulting shanten of the 13-tile hand after this discard. */
  shanten: number;
  /** Total unseen tiles that would advance shanten (sum of remaining counts in `waits`). */
  acceptance: number;
  /** Breakdown of improving draws. Empty when shanten is -1 (already won). */
  waits: WaitTile[];
}

/**
 * For each candidate discard from a 14-tile hand, compute the resulting
 * shanten and the acceptance count — the number of unseen tiles that would
 * advance the hand toward tenpai/win. This is the core training-mode metric:
 * the "best" discard maximises acceptance at the minimum shanten.
 *
 * `visibleTiles` is everything the player can see (their own hand counts toward
 * visibility, plus all discards and exposed melds from opponents). It excludes
 * concealed tiles in opponents' hands and the unrevealed wall.
 */
export class Ukeire {
  /**
   * Analyze every possible discard from a 14-tile hand. Bonus tiles are skipped
   * (they're never discarded). The returned array is in input order.
   */
  static analyzeAll(
    hand14: readonly Tile[],
    exposedSetCount: number,
    visibleTiles: readonly Tile[],
  ): DiscardAnalysis[] {
    const visibleCounts = countTiles(visibleTiles);
    const seenDiscardKeys = new Set<string>();
    const out: DiscardAnalysis[] = [];
    for (const candidate of hand14) {
      if (candidate.isBonus()) continue;
      // Dedupe by tile-type so two copies of the same tile yield one analysis.
      const key = candidate.toString();
      if (seenDiscardKeys.has(key)) continue;
      seenDiscardKeys.add(key);

      const remaining = removeOne(hand14, candidate);
      out.push(Ukeire.analyzeDiscard(candidate, remaining, exposedSetCount, visibleCounts));
    }
    return out;
  }

  /**
   * Pick the optimal discard: minimum shanten first, then maximum acceptance.
   * Tie-breaks on acceptance use sort-key (higher = terminals/honors discarded
   * first, keeping simples for waits).
   */
  static optimalDiscard(analyses: readonly DiscardAnalysis[]): DiscardAnalysis {
    if (analyses.length === 0) {
      throw new Error('Ukeire.optimalDiscard: no analyses to pick from');
    }
    let best = analyses[0]!;
    for (const a of analyses) {
      if (
        a.shanten < best.shanten ||
        (a.shanten === best.shanten && a.acceptance > best.acceptance) ||
        (a.shanten === best.shanten &&
          a.acceptance === best.acceptance &&
          a.discard.compareTo(best.discard) > 0)
      ) {
        best = a;
      }
    }
    return best;
  }

  /** Analyze a specific (discard, remaining-hand) pair. Exposed for tests. */
  static analyzeDiscard(
    discard: Tile,
    remaining: readonly Tile[],
    exposedSetCount: number,
    visibleCounts: number[],
  ): DiscardAnalysis {
    const shanten = Shanten.count(remaining, exposedSetCount);
    if (shanten === -1) {
      return { discard, shanten, acceptance: 0, waits: [] };
    }
    const waits: WaitTile[] = [];
    let acceptance = 0;
    for (let i = 0; i < NUM_TILE_TYPES; i++) {
      const candidate = indexToTile(i);
      const newShanten = Shanten.count([...remaining, candidate], exposedSetCount);
      if (newShanten < shanten) {
        // Don't subtract the candidate itself yet — we account for visibility
        // (which already includes our own 14-tile hand) via visibleCounts.
        const used = visibleCounts[i] ?? 0;
        const left = Math.max(0, 4 - used);
        if (left > 0) {
          waits.push({ tile: candidate, remaining: left });
          acceptance += left;
        }
      }
    }
    return { discard, shanten, acceptance, waits };
  }
}

function removeOne(tiles: readonly Tile[], target: Tile): Tile[] {
  const out: Tile[] = [];
  let removed = false;
  for (const t of tiles) {
    if (!removed && t.equals(target)) {
      removed = true;
      continue;
    }
    out.push(t);
  }
  return out;
}

// Re-export for trainer / AI convenience.
export { tileToIndex };
