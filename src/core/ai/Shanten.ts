import { Tile } from '@core/tiles/Tile';
import { Suit, SuitTile, type SuitRank } from '@core/tiles/SuitTile';
import { HonorTile, Wind, Dragon, type Honor } from '@core/tiles/HonorTile';

/**
 * Shanten (向聽) — the number of tile exchanges a hand is away from tenpai.
 *
 *   -1 = winning (14 tiles forming a complete hand)
 *    0 = tenpai (waiting on the last tile)
 *    n > 0 = n exchanges away from tenpai
 *
 * Used by the EfficiencyAI to pick discards (Phase 5) and by the training mode
 * (Phase 6) to compute optimal-discard probabilities.
 */

/** Encoded tile space: 0-8 = m1..m9, 9-17 = p1..p9, 18-26 = s1..s9, 27..33 = E,S,W,N,中,發,白. */
const NUM_TILE_TYPES = 34;

const HONORS_ORDER: readonly Honor[] = [
  Wind.East,
  Wind.South,
  Wind.West,
  Wind.North,
  Dragon.Red,
  Dragon.Green,
  Dragon.White,
];

const SUIT_OFFSET: Record<Suit, number> = {
  [Suit.Character]: 0,
  [Suit.Circle]: 9,
  [Suit.Bamboo]: 18,
};

/** Indices of the 13 terminal/honor "orphan" tiles (1m, 9m, 1p, 9p, 1s, 9s, E, S, W, N, 中, 發, 白). */
const ORPHAN_INDICES: readonly number[] = [0, 8, 9, 17, 18, 26, 27, 28, 29, 30, 31, 32, 33];

export type TileCounts = number[];

export function tileToIndex(t: Tile): number {
  if (t.isSuit()) return SUIT_OFFSET[t.suit] + (t.rank - 1);
  if (t.isHonor()) return 27 + HONORS_ORDER.indexOf(t.honor);
  return -1; // bonus tiles
}

export function indexToTile(i: number): Tile {
  if (i < 9) return new SuitTile(Suit.Character, (i + 1) as SuitRank);
  if (i < 18) return new SuitTile(Suit.Circle, (i + 1 - 9) as SuitRank);
  if (i < 27) return new SuitTile(Suit.Bamboo, (i + 1 - 18) as SuitRank);
  return new HonorTile(HONORS_ORDER[i - 27]!);
}

export function countTiles(tiles: readonly Tile[]): TileCounts {
  const counts = new Array(NUM_TILE_TYPES).fill(0) as TileCounts;
  for (const t of tiles) {
    const i = tileToIndex(t);
    if (i >= 0) counts[i]!++;
  }
  return counts;
}

export class Shanten {
  /**
   * Shanten of `concealed` with `exposedSetCount` already-revealed melds (each
   * meld counts as one set toward the 4-set target).
   */
  static count(concealed: readonly Tile[], exposedSetCount: number): number {
    const counts = countTiles(concealed);
    let best = Shanten.standardShanten(counts, exposedSetCount);
    // Special hands require no exposed melds.
    if (exposedSetCount === 0) {
      best = Math.min(best, Shanten.sevenPairsShanten(counts));
      best = Math.min(best, Shanten.thirteenOrphansShanten(counts));
    }
    return best;
  }

  /**
   * For a 14-tile hand (e.g., post-draw), return the discard that minimises
   * the resulting 13-tile shanten. Ties are broken by preferring the highest
   * sort-key tile (terminals/honors before simples) to keep simples for waits.
   * Bonus tiles are excluded — they never qualify as discards.
   */
  static bestDiscard(
    concealed: readonly Tile[],
    exposedSetCount: number,
  ): { discard: Tile; shanten: number } {
    const candidates = concealed.filter((t) => !t.isBonus());
    if (candidates.length === 0) {
      throw new Error('Shanten.bestDiscard: no non-bonus tiles available');
    }
    let best: { discard: Tile; shanten: number } | null = null;
    for (const candidate of candidates) {
      const remaining = removeOne(candidates, candidate);
      const sh = Shanten.count(remaining, exposedSetCount);
      if (
        best === null ||
        sh < best.shanten ||
        (sh === best.shanten && candidate.compareTo(best.discard) > 0)
      ) {
        best = { discard: candidate, shanten: sh };
      }
    }
    return best!;
  }

  /**
   * For a 13-tile tenpai hand, enumerate the tiles that would complete it.
   * Returns an empty array if not tenpai.
   */
  static waits(concealed: readonly Tile[], exposedSetCount: number): Tile[] {
    const base = Shanten.count(concealed, exposedSetCount);
    if (base !== 0) return [];
    const waits: Tile[] = [];
    for (let i = 0; i < NUM_TILE_TYPES; i++) {
      const candidate = indexToTile(i);
      const sh = Shanten.count([...concealed, candidate], exposedSetCount);
      if (sh === -1) waits.push(candidate);
    }
    return waits;
  }

  // ---------- Internal: standard form ----------

  static standardShanten(counts: TileCounts, exposedSetCount: number): number {
    const targetSets = 4 - exposedSetCount;
    if (targetSets < 0) return 8;

    let best = 8;
    // No designated pair (must form it later)
    best = Math.min(best, searchStandard(counts.slice(), targetSets, 0, 0, 0, false));
    // Try each tile as the designated pair
    for (let i = 0; i < NUM_TILE_TYPES; i++) {
      if (counts[i]! >= 2) {
        counts[i]! -= 2;
        best = Math.min(best, searchStandard(counts.slice(), targetSets, 0, 0, 0, true));
        counts[i]! += 2;
      }
    }
    return best;
  }

  // ---------- 七對 ----------

  static sevenPairsShanten(counts: TileCounts): number {
    let pairs = 0;
    let distinct = 0;
    for (const c of counts) {
      if (c >= 1) distinct++;
      if (c >= 2) pairs++;
    }
    // Each missing pair costs 1 step; each missing distinct kind costs an extra step
    // because we'd need to first acquire a tile then pair it.
    if (pairs >= 7) return -1;
    return 6 - pairs + Math.max(0, 7 - distinct);
  }

  // ---------- 十三么 ----------

  static thirteenOrphansShanten(counts: TileCounts): number {
    let have = 0;
    let hasPair = false;
    for (const i of ORPHAN_INDICES) {
      if (counts[i]! >= 1) have++;
      if (counts[i]! >= 2) hasPair = true;
    }
    return 13 - have - (hasPair ? 1 : 0);
  }
}

// ---------- Internal helpers ----------

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

/**
 * Recursive search for the best (lowest-shanten) decomposition of `counts`
 * into `sets` complete sets and `partials` partial sets, optionally with a
 * designated pair already removed.
 */
function searchStandard(
  counts: TileCounts,
  targetSets: number,
  sets: number,
  partials: number,
  startIdx: number,
  hasPair: boolean,
): number {
  // Find next nonzero tile from `startIdx` onward.
  let idx = startIdx;
  while (idx < NUM_TILE_TYPES && counts[idx] === 0) idx++;
  if (idx >= NUM_TILE_TYPES) {
    return scoreDecomposition(sets, partials, hasPair, targetSets);
  }

  let best = 8;
  const isHonor = idx >= 27;
  const rank = isHonor ? -1 : idx % 9;

  // 1. Triplet (pong) of this tile
  if (counts[idx]! >= 3) {
    counts[idx]! -= 3;
    best = Math.min(best, searchStandard(counts, targetSets, sets + 1, partials, idx, hasPair));
    counts[idx]! += 3;
  }

  // 2. Sequence (chi) starting at this tile — suit only, rank 0..6
  if (!isHonor && rank <= 6 && counts[idx + 1]! > 0 && counts[idx + 2]! > 0) {
    counts[idx]!--;
    counts[idx + 1]!--;
    counts[idx + 2]!--;
    best = Math.min(best, searchStandard(counts, targetSets, sets + 1, partials, idx, hasPair));
    counts[idx]!++;
    counts[idx + 1]!++;
    counts[idx + 2]!++;
  }

  // 3. Pair as partial (counted in `partials`; designated pair is separate)
  if (counts[idx]! >= 2) {
    counts[idx]! -= 2;
    best = Math.min(best, searchStandard(counts, targetSets, sets, partials + 1, idx, hasPair));
    counts[idx]! += 2;
  }

  // 4. Two-tile partial: ryanmen / penchan (adjacent ranks) — suit only
  if (!isHonor && rank <= 7 && counts[idx + 1]! > 0) {
    counts[idx]!--;
    counts[idx + 1]!--;
    best = Math.min(best, searchStandard(counts, targetSets, sets, partials + 1, idx, hasPair));
    counts[idx]!++;
    counts[idx + 1]!++;
  }

  // 5. Two-tile partial: kanchan (gap of 1) — suit only
  if (!isHonor && rank <= 6 && counts[idx + 2]! > 0) {
    counts[idx]!--;
    counts[idx + 2]!--;
    best = Math.min(best, searchStandard(counts, targetSets, sets, partials + 1, idx, hasPair));
    counts[idx]!++;
    counts[idx + 2]!++;
  }

  // 6. Skip — leave this tile as a floater
  counts[idx]!--;
  best = Math.min(best, searchStandard(counts, targetSets, sets, partials, idx, hasPair));
  counts[idx]!++;

  return best;
}

function scoreDecomposition(
  sets: number,
  partials: number,
  hasPair: boolean,
  targetSets: number,
): number {
  // Can't use more partials than open set slots remaining.
  const usablePartials = Math.min(partials, Math.max(0, targetSets - sets));
  // shanten = 2 * (sets remaining) - usable partials - (pair bonus)
  // Tenpai = 0; winning = -1.
  let shanten = 2 * (targetSets - sets) - usablePartials;
  if (hasPair) shanten -= 1;
  // For 13-tile hands without pair AND no slot for it, we still need the pair;
  // the formula naturally handles this (no -1 bonus). Floor at -1.
  return shanten;
}
