// Hand-shape math on 34-slot count vectors: winning decompositions, shanten
// (向聽), waits and discard acceptance (受入). Variant-agnostic — `sets` is the
// number of sets the concealed part still has to make (4 − melds for 13-tile
// variants, 5 − melds for Taiwan's 16), so the same code serves both.

import { ORPHANS, PLAY_KINDS, type Kind } from './tiles';

export interface ShapeOptions {
  /** Count 七對子 (seven pairs) as a winning shape. */
  sevenPairs?: boolean;
  /** Count 十三么 (thirteen orphans) as a winning shape. Default true. */
  thirteenOrphans?: boolean;
}

export type SetType = 'chi' | 'pong';
export interface ConcealedSet {
  type: SetType;
  /** Pong: its kind. Chi: its lowest kind. */
  kind: Kind;
}
export interface Decomposition {
  pair: Kind;
  sets: ConcealedSet[];
}

const sum = (c: readonly number[]) => c.reduce((a, b) => a + b, 0);

// ------------------------------------------------------------ decomposition

/**
 * Every way to split `counts` into exactly `sets` sets plus one pair (the
 * standard winning shape). Empty when the tiles don't form one. Distinct
 * decompositions only (e.g. 111222333m comes back as three pongs and as three
 * chis).
 */
export function decompose(counts: readonly number[], sets: number): Decomposition[] {
  if (sum(counts) !== sets * 3 + 2) return [];
  const out: Decomposition[] = [];
  const seen = new Set<string>();
  const c = counts.slice();
  const acc: ConcealedSet[] = [];
  const walk = (pair: Kind, from: number) => {
    let i = from;
    while (i < PLAY_KINDS && c[i] === 0) i++;
    if (i === PLAY_KINDS) {
      const key = pair + ':' + acc.map((s) => s.type[0]! + s.kind).sort().join(',');
      if (!seen.has(key)) {
        seen.add(key);
        out.push({ pair, sets: acc.map((s) => ({ ...s })) });
      }
      return;
    }
    if (c[i]! >= 3) {
      c[i]! -= 3;
      acc.push({ type: 'pong', kind: i });
      walk(pair, i);
      acc.pop();
      c[i]! += 3;
    }
    if (i < 27 && i % 9 <= 6 && c[i + 1]! > 0 && c[i + 2]! > 0) {
      c[i]!--;
      c[i + 1]!--;
      c[i + 2]!--;
      acc.push({ type: 'chi', kind: i });
      walk(pair, i);
      acc.pop();
      c[i]!++;
      c[i + 1]!++;
      c[i + 2]!++;
    }
  };
  for (let p = 0; p < PLAY_KINDS; p++) {
    if (c[p]! < 2) continue;
    c[p]! -= 2;
    walk(p, 0);
    c[p]! += 2;
  }
  return out;
}

export function isSevenPairs(counts: readonly number[]): boolean {
  let pairs = 0;
  for (const n of counts) {
    if (n === 2) pairs++;
    else if (n !== 0) return false;
  }
  return pairs === 7;
}

export function isThirteenOrphans(counts: readonly number[]): boolean {
  if (sum(counts) !== 14) return false;
  let pair = false;
  for (let k = 0; k < PLAY_KINDS; k++) {
    const n = counts[k]!;
    const orphan = ORPHANS.includes(k);
    if (!orphan && n > 0) return false;
    if (orphan && n === 0) return false;
    if (n === 2) pair = true;
    if (n > 2) return false;
  }
  return pair;
}

/** Does `counts` (with `sets` sets still to make) form a complete hand? */
export function isComplete(counts: readonly number[], sets: number, opts: ShapeOptions = {}): boolean {
  return shanten(counts, sets, opts) === -1;
}

// ------------------------------------------------------------ shanten

// Per-group search, memoized on the group's count vector. A group is one suit
// (9 kinds, sequences allowed) or the honors (7 kinds). Each result lists the
// non-dominated (sets, partials, pair) triples the group can make; the groups
// are then combined with at most one pair overall.
type Triple = [number, number, number];
const memo = new Map<number, Triple[]>();

function groupKey(c: readonly number[], from: number, len: number, honor: boolean): number {
  let key = 0;
  for (let i = 0; i < len; i++) key = key * 5 + c[from + i]!;
  return honor ? -key - 1 : key;
}

function prune(list: Triple[]): Triple[] {
  const out: Triple[] = [];
  for (const a of list) {
    if (list.some((b) => b !== a && b[2] === a[2] && b[0] >= a[0] && b[1] >= a[1] && (b[0] > a[0] || b[1] > a[1]))) continue;
    if (out.some((b) => b[0] === a[0] && b[1] === a[1] && b[2] === a[2])) continue;
    out.push(a);
  }
  return out;
}

function explore(c: number[], from: number, len: number, honor: boolean): Triple[] {
  const key = groupKey(c, from, len, honor);
  const hit = memo.get(key);
  if (hit) return hit;
  let i = 0;
  while (i < len && c[from + i] === 0) i++;
  if (i === len) {
    const base: Triple[] = [[0, 0, 0]];
    memo.set(key, base);
    return base;
  }
  const at = from + i;
  const results: Triple[] = [];
  const add = (dm: number, dt: number, dp: number) => {
    for (const [m, t, p] of explore(c, from, len, honor)) {
      if (p + dp <= 1) results.push([m + dm, t + dt, p + dp]);
    }
  };
  if (c[at]! >= 3) {
    c[at]! -= 3;
    add(1, 0, 0);
    c[at]! += 3;
  }
  if (!honor && i + 2 < len && c[at + 1]! > 0 && c[at + 2]! > 0) {
    c[at]!--;
    c[at + 1]!--;
    c[at + 2]!--;
    add(1, 0, 0);
    c[at]!++;
    c[at + 1]!++;
    c[at + 2]!++;
  }
  if (c[at]! >= 2) {
    c[at]! -= 2;
    add(0, 0, 1);
    add(0, 1, 0);
    c[at]! += 2;
  }
  if (!honor && i + 1 < len && c[at + 1]! > 0) {
    c[at]!--;
    c[at + 1]!--;
    add(0, 1, 0);
    c[at]!++;
    c[at + 1]!++;
  }
  if (!honor && i + 2 < len && c[at + 2]! > 0) {
    c[at]!--;
    c[at + 2]!--;
    add(0, 1, 0);
    c[at]!++;
    c[at + 2]!++;
  }
  c[at]!--;
  add(0, 0, 0);
  c[at]!++;
  const pruned = prune(results);
  if (memo.size > 400_000) memo.clear();
  memo.set(key, pruned);
  return pruned;
}

/** Shanten of the standard (sets + pair) shape only. */
export function standardShanten(counts: readonly number[], sets: number): number {
  const c = counts.slice();
  const groups = [explore(c, 0, 9, false), explore(c, 9, 9, false), explore(c, 18, 9, false), explore(c, 27, 7, true)];
  let best = 99;
  for (const a of groups[0]!)
    for (const b of groups[1]!)
      for (const d of groups[2]!)
        for (const e of groups[3]!) {
          const p = a[2] + b[2] + d[2] + e[2];
          if (p > 1) continue;
          const m = Math.min(sets, a[0] + b[0] + d[0] + e[0]);
          const t = Math.min(a[1] + b[1] + d[1] + e[1], sets - m);
          const s = 2 * (sets - m) - t - p;
          if (s < best) best = s;
        }
  return best;
}

export function sevenPairsShanten(counts: readonly number[]): number {
  let pairs = 0;
  let distinct = 0;
  for (const n of counts) {
    if (n >= 1) distinct++;
    if (n >= 2) pairs++;
  }
  return 6 - pairs + Math.max(0, 7 - distinct);
}

export function thirteenOrphansShanten(counts: readonly number[]): number {
  let have = 0;
  let pair = false;
  for (const k of ORPHANS) {
    if (counts[k]! >= 1) have++;
    if (counts[k]! >= 2) pair = true;
  }
  return 13 - have - (pair ? 1 : 0);
}

/**
 * Shanten: −1 = complete hand, 0 = tenpai (one tile away), n = n tile swaps
 * from tenpai. Special shapes only count with no melds (`sets` = 4).
 */
export function shanten(counts: readonly number[], sets: number, opts: ShapeOptions = {}): number {
  let best = standardShanten(counts, sets);
  if (sets === 4) {
    if (opts.sevenPairs) best = Math.min(best, sevenPairsShanten(counts));
    if (opts.thirteenOrphans !== false) best = Math.min(best, thirteenOrphansShanten(counts));
  }
  return best;
}

/** Kinds that would complete a tenpai hand (empty when not tenpai). Kinds already held 4× are skipped. */
export function waits(counts: readonly number[], sets: number, opts: ShapeOptions = {}): Kind[] {
  const c = counts.slice();
  const out: Kind[] = [];
  for (let k = 0; k < PLAY_KINDS; k++) {
    if (c[k]! >= 4) continue;
    c[k]!++;
    if (shanten(c, sets, opts) === -1) out.push(k);
    c[k]!--;
  }
  return out;
}

// ------------------------------------------------------------ acceptance

export interface DiscardInfo {
  kind: Kind;
  /** Shanten of the hand after this discard. */
  shanten: number;
  /** Unseen tiles that lower that shanten (or complete the hand when tenpai). */
  acceptance: number;
  accepts: { kind: Kind; left: number }[];
}

/**
 * For a hand with one tile too many (just drew), analyse every distinct
 * discard: resulting shanten, and how many unseen tiles would improve it.
 * `visible` counts the tiles this player can see (own hand included).
 */
export function analyzeDiscards(
  counts: readonly number[],
  sets: number,
  visible: readonly number[],
  opts: ShapeOptions = {},
): DiscardInfo[] {
  const c = counts.slice();
  const out: DiscardInfo[] = [];
  for (let k = 0; k < PLAY_KINDS; k++) {
    if (c[k] === 0) continue;
    c[k]!--;
    const s = shanten(c, sets, opts);
    const accepts: { kind: Kind; left: number }[] = [];
    let acceptance = 0;
    for (let d = 0; d < PLAY_KINDS; d++) {
      const left = 4 - visible[d]!;
      if (left <= 0) continue;
      c[d]!++;
      if (shanten(c, sets, opts) < s) {
        accepts.push({ kind: d, left });
        acceptance += left;
      }
      c[d]!--;
    }
    out.push({ kind: k, shanten: s, acceptance, accepts });
    c[k]!++;
  }
  return out;
}

/** Lowest shanten, then widest acceptance, then the outermost tile (terminals and honors go first). */
export function bestByEfficiency(list: readonly DiscardInfo[]): DiscardInfo {
  let best = list[0]!;
  for (const d of list) {
    if (
      d.shanten < best.shanten ||
      (d.shanten === best.shanten && d.acceptance > best.acceptance) ||
      (d.shanten === best.shanten && d.acceptance === best.acceptance && outerness(d.kind) > outerness(best.kind))
    ) {
      best = d;
    }
  }
  return best;
}

/** Honors > terminals > 2/8 > the middle: a tie-break for "discard the least connected tile". */
export function outerness(k: Kind): number {
  if (k >= 27) return 10;
  const r = k % 9;
  return Math.max(r, 8 - r);
}
