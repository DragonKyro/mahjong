import { describe, expect, it } from 'vitest';
import {
  analyzeDiscards,
  bestByEfficiency,
  decompose,
  isSevenPairs,
  isThirteenOrphans,
  sevenPairsShanten,
  shanten,
  standardShanten,
  thirteenOrphansShanten,
  waits,
  type ShapeOptions,
} from './hand';
import { Rng } from './rng';
import { countKinds, formatKinds, kindOf, parseKinds } from './tiles';

const c = (text: string) => countKinds(parseKinds(text));

describe('tiles notation', () => {
  it('round-trips', () => {
    expect(formatKinds(parseKinds('123m 456p 789s 1234567z 18f'))).toBe('123m456p789s1234567z18f');
  });
  it('maps ids to kinds', () => {
    expect(kindOf(0)).toBe(0);
    expect(kindOf(135)).toBe(33);
    expect(kindOf(136)).toBe(34);
    expect(kindOf(143)).toBe(41);
    expect(kindOf(150)).toBe(42);
  });
});

describe('decompose', () => {
  it('finds the standard shape', () => {
    const ds = decompose(c('123m 456p 789s 111z 22z'), 4);
    expect(ds).toHaveLength(1);
    expect(ds[0]!.pair).toBe(28);
  });
  it('returns every distinct reading', () => {
    // 111222333m: three pongs or three chows.
    expect(decompose(c('111222333m 789p 55s'), 4)).toHaveLength(2);
  });
  it('rejects non-hands', () => {
    expect(decompose(c('123m 456p 789s 111z 23z'), 4)).toHaveLength(0);
  });
  it('works with melds (fewer sets)', () => {
    expect(decompose(c('123m 55p'), 1)).toHaveLength(1);
  });
});

describe('special shapes', () => {
  it('thirteen orphans', () => {
    expect(isThirteenOrphans(c('19m19p19s1234567z1m'))).toBe(true);
    expect(isThirteenOrphans(c('19m19p19s1234566z1m'))).toBe(false);
  });
  it('seven pairs needs seven different pairs', () => {
    expect(isSevenPairs(c('1122m3344p5566s77z'))).toBe(true);
    expect(isSevenPairs(c('1111m3344p5566s77z'))).toBe(false);
  });
});

describe('shanten', () => {
  it('complete / tenpai / far', () => {
    expect(shanten(c('123m 456p 789s 111z 22z'), 4)).toBe(-1);
    expect(shanten(c('123m 456p 789s 111z 2z'), 4)).toBe(0);
    expect(shanten(c('123m 456p 789s 11z 23z'), 4)).toBe(1);
    expect(shanten(c('159m 159p 159s 1357z'), 4, { thirteenOrphans: false })).toBe(8);
    expect(shanten(c('159m 159p 159s 1357z'), 4)).toBe(3); // ten orphans already
  });
  it('special shapes only when allowed', () => {
    const sp = c('1122m3344p5566s7z');
    expect(shanten(sp, 4)).toBeGreaterThan(0);
    expect(shanten(sp, 4, { sevenPairs: true })).toBe(0);
    expect(shanten(c('19m19p19s1234567z'), 4)).toBe(0);
  });
  it('handles melds', () => {
    expect(shanten(c('123m 5p'), 1)).toBe(0);
    expect(shanten(c('5p'), 0)).toBe(0);
  });
});

describe('waits and acceptance', () => {
  it('two-sided wait', () => {
    expect(formatKinds(waits(c('123m 456p 789s 11z 34m'), 4))).toBe('25m');
  });
  it('nine gates waits on every tile of the suit', () => {
    expect(waits(c('1112345678999m'), 4)).toHaveLength(9);
  });
  it('picks the efficient discard', () => {
    const counts = c('123m 456p 789s 11z 34m 7z');
    const visible = counts.slice();
    const best = bestByEfficiency(analyzeDiscards(counts, 4, visible));
    expect(best.kind).toBe(parseKinds('7z')[0]);
    expect(best.shanten).toBe(0);
  });
});

// ------------------------------------------------------------ the fast paths match the plain algorithm

// The pre-optimisation shanten (every combination of the four groups' options), kept as a reference.
type Triple = [number, number, number];
const refMemo = new Map<number, Triple[]>();

function refKey(c: readonly number[], from: number, len: number, honor: boolean): number {
  let key = 0;
  for (let i = 0; i < len; i++) key = key * 5 + c[from + i]!;
  return honor ? -key - 1 : key;
}

function refPrune(list: Triple[]): Triple[] {
  const out: Triple[] = [];
  for (const a of list) {
    if (list.some((b) => b !== a && b[2] === a[2] && b[0] >= a[0] && b[1] >= a[1] && (b[0] > a[0] || b[1] > a[1]))) continue;
    if (out.some((b) => b[0] === a[0] && b[1] === a[1] && b[2] === a[2])) continue;
    out.push(a);
  }
  return out;
}

function refExplore(c: number[], from: number, len: number, honor: boolean): Triple[] {
  const key = refKey(c, from, len, honor);
  const hit = refMemo.get(key);
  if (hit) return hit;
  let i = 0;
  while (i < len && c[from + i] === 0) i++;
  if (i === len) {
    const base: Triple[] = [[0, 0, 0]];
    refMemo.set(key, base);
    return base;
  }
  const at = from + i;
  const results: Triple[] = [];
  const add = (dm: number, dt: number, dp: number) => {
    for (const [m, t, p] of refExplore(c, from, len, honor)) {
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
  const pruned = refPrune(results);
  if (refMemo.size > 400_000) refMemo.clear();
  refMemo.set(key, pruned);
  return pruned;
}

function refStandardShanten(counts: readonly number[], sets: number): number {
  const c = counts.slice();
  const groups = [refExplore(c, 0, 9, false), refExplore(c, 9, 9, false), refExplore(c, 18, 9, false), refExplore(c, 27, 7, true)];
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

function refShanten(counts: readonly number[], sets: number, opts: ShapeOptions = {}): number {
  let best = refStandardShanten(counts, sets);
  if (sets === 4) {
    if (opts.sevenPairs) best = Math.min(best, sevenPairsShanten(counts));
    if (opts.thirteenOrphans !== false) best = Math.min(best, thirteenOrphansShanten(counts));
  }
  return best;
}

describe('fast shanten', () => {
  const rng = new Rng(77);
  const hands: { counts: number[]; sets: number }[] = [];
  for (let i = 0; i < 3000; i++) {
    const sets = 4 - (i % 4 === 3 ? 1 + rng.int(3) : 0);
    const n = 3 * sets + 1 + (i % 2);
    const pool = rng.shuffle([...Array(136).keys()]).slice(0, n);
    // Some hands drawn from a narrow range of kinds, to get connected shapes.
    const narrow = i % 3 === 0;
    const counts = new Array<number>(34).fill(0);
    for (const t of pool) counts[narrow ? (t >> 2) % 12 : t >> 2]!++;
    if (counts.some((x) => x > 4)) continue;
    hands.push({ counts, sets });
  }

  it('standard shanten equals the plain combination', () => {
    for (const { counts, sets } of hands) expect(standardShanten(counts, sets)).toBe(refStandardShanten(counts, sets));
  });

  it('waits and acceptance skip only draws that cannot help', () => {
    for (const opts of [{}, { sevenPairs: true }, { thirteenOrphans: false }]) {
      for (const { counts, sets } of hands.slice(0, 600)) {
        const total = counts.reduce((a, b) => a + b, 0);
        if (total % 3 === 1) {
          const want: number[] = [];
          const x = counts.slice();
          for (let k = 0; k < 34; k++) {
            if (x[k]! >= 4) continue;
            x[k]!++;
            if (refShanten(x, sets, opts) === -1) want.push(k);
            x[k]!--;
          }
          expect(waits(counts, sets, opts)).toEqual(want);
        } else {
          const visible = counts.slice();
          for (const d of analyzeDiscards(counts, sets, visible, opts)) {
            const x = counts.slice();
            x[d.kind]!--;
            const s = refShanten(x, sets, opts);
            let acc = 0;
            for (let k = 0; k < 34; k++) {
              if (4 - visible[k]! <= 0) continue;
              x[k]!++;
              if (refShanten(x, sets, opts) < s) acc += 4 - visible[k]!;
              x[k]!--;
            }
            expect([d.shanten, d.acceptance]).toEqual([s, acc]);
          }
        }
      }
    }
  });
});
