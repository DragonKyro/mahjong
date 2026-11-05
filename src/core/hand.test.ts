import { describe, expect, it } from 'vitest';
import { analyzeDiscards, bestByEfficiency, decompose, isSevenPairs, isThirteenOrphans, shanten, waits } from './hand';
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
