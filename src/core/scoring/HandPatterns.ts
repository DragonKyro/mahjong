import { Tile } from '@core/tiles/Tile';
import { SuitTile, Suit } from '@core/tiles/SuitTile';
import { HonorTile, Wind, Dragon } from '@core/tiles/HonorTile';
import { Meld } from '@core/melds/Meld';

/** A set discovered inside the concealed portion (chi or pong; never kong here — kongs are always exposed). */
export type DiscoveredSet = {
  kind: 'chi' | 'pong';
  tiles: readonly Tile[];
};

/** Result of decomposing a hand into 4 sets + 1 pair. */
export interface StandardDecomposition {
  kind: 'standard';
  /** The pair (eyes / 雀頭). */
  pairTile: Tile;
  /** The four sets in the hand. Exposed melds are passed through; discovered sets from concealed tiles fill the rest. */
  exposedMelds: readonly Meld[];
  discoveredSets: readonly DiscoveredSet[];
  /** All four sets together (for convenience — exposed first, then discovered). */
  allSets: readonly { kind: 'chi' | 'pong' | 'kong'; tiles: readonly Tile[]; concealed: boolean }[];
}

export interface SevenPairsDecomposition {
  kind: 'seven-pairs';
  /** The 7 distinct tile-types that make up the hand. */
  pairs: readonly Tile[];
}

export interface ThirteenOrphansDecomposition {
  kind: 'thirteen-orphans';
}

export type WinningHand =
  | StandardDecomposition
  | SevenPairsDecomposition
  | ThirteenOrphansDecomposition;

/** The 13 terminal/honor tile-types that form 十三么. */
const ORPHAN_KEYS = (() => {
  const tiles: Tile[] = [
    new SuitTile(Suit.Character, 1),
    new SuitTile(Suit.Character, 9),
    new SuitTile(Suit.Circle, 1),
    new SuitTile(Suit.Circle, 9),
    new SuitTile(Suit.Bamboo, 1),
    new SuitTile(Suit.Bamboo, 9),
    new HonorTile(Wind.East),
    new HonorTile(Wind.South),
    new HonorTile(Wind.West),
    new HonorTile(Wind.North),
    new HonorTile(Dragon.Red),
    new HonorTile(Dragon.Green),
    new HonorTile(Dragon.White),
  ];
  return new Set(tiles.map((t) => t.toString()));
})();

/** Pattern recognizer: enumerate every winning decomposition of a hand. */
export class HandPatterns {
  /**
   * Find every winning decomposition of (concealed tiles + winningTile + exposed melds).
   * Returns an empty array if no decomposition is winning. Multiple results are possible
   * because some hands admit several ways to split the same tiles into sets — faan scoring
   * picks the highest-scoring decomposition.
   */
  static findWinningDecompositions(
    concealed: readonly Tile[],
    winningTile: Tile,
    exposedMelds: readonly Meld[],
  ): WinningHand[] {
    const out: WinningHand[] = [];
    // Bonus tiles never participate in the winning hand structure.
    if (winningTile.isBonus()) return out;

    // Special hands require no exposed melds.
    if (exposedMelds.length === 0) {
      const seven = HandPatterns.findSevenPairs(concealed, winningTile);
      if (seven) out.push(seven);
      const orphans = HandPatterns.findThirteenOrphans(concealed, winningTile);
      if (orphans) out.push(orphans);
    }

    out.push(...HandPatterns.findStandardDecompositions(concealed, winningTile, exposedMelds));
    return out;
  }

  /** True if the hand admits any winning decomposition. */
  static canWin(
    concealed: readonly Tile[],
    winningTile: Tile,
    exposedMelds: readonly Meld[],
  ): boolean {
    return HandPatterns.findWinningDecompositions(concealed, winningTile, exposedMelds).length > 0;
  }

  static findStandardDecompositions(
    concealed: readonly Tile[],
    winningTile: Tile,
    exposedMelds: readonly Meld[],
  ): StandardDecomposition[] {
    const free = [...concealed, winningTile].filter((t) => !t.isBonus());
    const setsNeeded = 4 - exposedMelds.length;
    if (setsNeeded < 0) return [];
    // Each exposed kong is one "set" toward the count of 4.
    const expectedFreeCount = setsNeeded * 3 + 2;
    if (free.length !== expectedFreeCount) return [];

    const ms = toMultiset(free);
    const out: StandardDecomposition[] = [];
    for (const entry of ms.values()) {
      if (entry.count < 2) continue;
      const without = cloneMultiset(ms);
      decrement(without, entry.tile, 2);
      const setLists = decomposeSets(without, setsNeeded);
      for (const sets of setLists) {
        out.push({
          kind: 'standard',
          pairTile: entry.tile,
          exposedMelds,
          discoveredSets: sets,
          allSets: [
            ...exposedMelds.map((m) => ({
              kind: m.type as 'chi' | 'pong' | 'kong',
              tiles: m.tiles,
              concealed: m.concealed,
            })),
            ...sets.map((s) => ({ kind: s.kind, tiles: s.tiles, concealed: true })),
          ],
        });
      }
    }
    return out;
  }

  static findSevenPairs(
    concealed: readonly Tile[],
    winningTile: Tile,
  ): SevenPairsDecomposition | null {
    const free = [...concealed, winningTile].filter((t) => !t.isBonus());
    if (free.length !== 14) return null;
    const ms = toMultiset(free);
    const pairs: Tile[] = [];
    for (const entry of ms.values()) {
      if (entry.count !== 2) return null;
      pairs.push(entry.tile);
    }
    if (pairs.length !== 7) return null;
    return { kind: 'seven-pairs', pairs };
  }

  static findThirteenOrphans(
    concealed: readonly Tile[],
    winningTile: Tile,
  ): ThirteenOrphansDecomposition | null {
    const free = [...concealed, winningTile].filter((t) => !t.isBonus());
    if (free.length !== 14) return null;
    const ms = toMultiset(free);
    let extras = 0;
    for (const entry of ms.values()) {
      if (!ORPHAN_KEYS.has(entry.tile.toString())) return null;
      if (entry.count === 2) extras++;
      else if (entry.count !== 1) return null;
    }
    // All 13 orphan types must appear, with exactly one of them duplicated.
    if (ms.size !== 13 || extras !== 1) return null;
    return { kind: 'thirteen-orphans' };
  }
}

// ---------- Internal multiset machinery ----------

type Multiset = Map<string, { tile: Tile; count: number }>;

function toMultiset(tiles: readonly Tile[]): Multiset {
  const m: Multiset = new Map();
  for (const t of tiles) {
    const key = t.toString();
    const e = m.get(key);
    if (e) e.count++;
    else m.set(key, { tile: t, count: 1 });
  }
  return m;
}

function cloneMultiset(m: Multiset): Multiset {
  const out: Multiset = new Map();
  for (const [k, v] of m) out.set(k, { tile: v.tile, count: v.count });
  return out;
}

function decrement(m: Multiset, tile: Tile, by: number): void {
  const key = tile.toString();
  const e = m.get(key);
  if (!e || e.count < by) {
    throw new Error(`Cannot decrement ${key} by ${by}`);
  }
  e.count -= by;
  if (e.count === 0) m.delete(key);
}

function lowestEntry(m: Multiset): { tile: Tile; count: number } | null {
  let best: { tile: Tile; count: number } | null = null;
  for (const e of m.values()) {
    if (!best || e.tile.compareTo(best.tile) < 0) best = e;
  }
  return best;
}

/**
 * Enumerate every way to partition the multiset into `setsNeeded` chi/pong sets.
 * Returns one result per distinct partition.
 */
function decomposeSets(m: Multiset, setsNeeded: number): DiscoveredSet[][] {
  if (setsNeeded === 0) return m.size === 0 ? [[]] : [];
  if (m.size === 0) return [];

  const out: DiscoveredSet[][] = [];
  const lo = lowestEntry(m);
  if (!lo) return [];

  // Try pong of the lowest tile.
  if (lo.count >= 3) {
    const m2 = cloneMultiset(m);
    decrement(m2, lo.tile, 3);
    for (const tail of decomposeSets(m2, setsNeeded - 1)) {
      out.push([{ kind: 'pong', tiles: [lo.tile, lo.tile, lo.tile] }, ...tail]);
    }
  }

  // Try chi starting at the lowest tile (suit only, rank ≤ 7).
  if (lo.tile.isSuit() && lo.tile.rank <= 7) {
    const r2Key = `${lo.tile.rank + 1}${lo.tile.suit}`;
    const r3Key = `${lo.tile.rank + 2}${lo.tile.suit}`;
    const t2 = m.get(r2Key);
    const t3 = m.get(r3Key);
    if (t2 && t3) {
      const m2 = cloneMultiset(m);
      decrement(m2, lo.tile, 1);
      decrement(m2, t2.tile, 1);
      decrement(m2, t3.tile, 1);
      for (const tail of decomposeSets(m2, setsNeeded - 1)) {
        out.push([{ kind: 'chi', tiles: [lo.tile, t2.tile, t3.tile] }, ...tail]);
      }
    }
  }

  return out;
}
