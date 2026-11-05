import { describe, expect, it } from 'vitest';
import { parseKinds } from '../tiles';
import { DEFAULT_HK_RULES, evaluateHk, liabilityFor, settleHk, tablePoints, type HkRules } from './hk';
import type { MeldFact, WinInput } from './index';

const R = DEFAULT_HK_RULES;
const k = (text: string) => parseKinds(text)[0]!;

function input(concealed: string, win: string, o: Partial<WinInput> = {}): WinInput {
  return {
    seat: 0,
    seatWind: 1, // South, so East pongs only count as the prevailing wind
    prevailing: 0,
    dealer: 3,
    concealed: parseKinds(concealed),
    winTile: k(win),
    melds: [],
    bonus: [],
    selfDraw: false,
    from: 1,
    robbingKong: false,
    lastTile: false,
    kongReplacement: 0,
    heavenly: false,
    earthly: false,
    flowerWin: null,
    wallLeft: 40,
    discardUnseen: false,
    ...o,
  };
}

const meld = (type: MeldFact['type'], kind: string, from: number | null = 2, order = 0): MeldFact => ({
  type,
  kind: k(kind),
  concealed: from === null,
  from,
  order,
});

const ids = (i: WinInput, rules: HkRules = R) => evaluateHk(i, rules)?.items.map((x) => x.id).sort();

describe('HK faan', () => {
  it('common hand, concealed, no flowers = 3 faan on a discard', () => {
    const s = evaluateHk(input('123m 456m 234p 789s 55p', '5p'), R)!;
    expect(s.items.map((i) => i.id).sort()).toEqual(['commonHand', 'concealed', 'noFlowers']);
    expect(s.value).toBe(3);
  });

  it('self-draw adds 自摸', () => {
    expect(evaluateHk(input('123m 456m 234p 789s 55p', '5p', { selfDraw: true, from: null }), R)!.value).toBe(4);
  });

  it('an open chicken hand scores nothing', () => {
    const s = evaluateHk(input('456m 234p 789s 55p', '5p', { melds: [meld('chi', '1m')], bonus: [k('3f')] }), R)!;
    expect(s.items.map((i) => i.id)).toEqual(['commonHand']);
  });

  it('all one suit is 7', () => {
    const s = evaluateHk(input('123m 456m 789m 222m 55m', '5m', { melds: [] }), R)!;
    expect(s.items.find((i) => i.id === 'allOneSuit')?.value).toBe(7);
  });

  it('mixed one suit + all triplets + prevailing wind', () => {
    const i = input('111m 555m 999m 111z 22z', '5m');
    expect(ids(i)).toEqual(['allTriplets', 'concealed', 'mixedOneSuit', 'noFlowers', 'prevailingWind'].sort());
    expect(evaluateHk(i, R)!.raw).toBe(9);
  });

  it('坎坎糊 when the discard only completes the pair', () => {
    const s = evaluateHk(input('111m 555m 999m 111z 22z', '2z'), R)!;
    expect(s.items[0]!.id).toBe('fourConcealedPongs');
    expect(s.limit).toBe(true);
    expect(s.items.some((i) => i.id === 'concealed')).toBe(false);
  });

  it('small and great dragons include the dragon pongs', () => {
    const small = evaluateHk(input('555z 666z 77z 123m 456m', '6m'), R)!;
    expect(small.items.find((i) => i.id === 'smallDragons')?.value).toBe(5);
    expect(small.items.some((i) => i.id === 'dragonPong')).toBe(false);
    const great = evaluateHk(input('555z 666z 777z 123m 99m', '9m'), R)!;
    expect(great.items.find((i) => i.id === 'greatDragons')?.value).toBe(8);
    expect(great.value).toBe(10); // 8 + mixed one suit 3 + … capped at 10
  });

  it('seat and prevailing wind stack for a double wind', () => {
    const s = evaluateHk(input('111z 123m 456m 789p 55s', '5s', { seatWind: 0, prevailing: 0 }), R)!;
    expect(s.items.filter((i) => i.id === 'seatWind' || i.id === 'prevailingWind')).toHaveLength(2);
  });

  it('flowers: seat flower, full set, none', () => {
    const base = '123m 456m 234p 789s 55p';
    expect(ids(input(base, '5p', { bonus: [k('2f')] }))).toContain('seatFlower'); // 蘭 = South
    expect(ids(input(base, '5p', { bonus: [k('1f')] }))).not.toContain('seatFlower');
    const set = evaluateHk(input(base, '5p', { bonus: parseKinds('1234f 6f') }), R)!;
    expect(set.items.filter((i) => i.id === 'flowerSet')).toHaveLength(1);
    expect(set.items.filter((i) => i.id === 'seatFlower')).toHaveLength(1); // 夏 = South season
  });

  it('limit hands ignore honors and flowers but keep winning conditions', () => {
    const s = evaluateHk(input('111z 222z 555z 66z', '6z', { melds: [meld('pong', '3z')], selfDraw: true, from: null }), R)!;
    expect(s.items.map((i) => i.id)).toEqual(['allHonors', 'selfDraw']);
    expect(s.value).toBe(10);
    expect(s.raw).toBe(11);
  });

  it('thirteen orphans, nine gates, all kongs, great winds', () => {
    expect(evaluateHk(input('19m19p19s1234567z1m', '1m'), R)!.items[0]!.id).toBe('thirteenOrphans');
    expect(evaluateHk(input('1112345678999m5m', '5m'), R)!.items[0]!.id).toBe('nineGates');
    const kongs = [meld('kong', '2m', 1, 0), meld('kong', '3p', 1, 1), meld('kong', '4s', 1, 2), meld('kong', '5s', null, 3)];
    expect(evaluateHk(input('99m', '9m', { melds: kongs }), R)!.items[0]!.id).toBe('allKongs');
    expect(evaluateHk(input('111z 222z 333z 444z 55m', '5m'), R)!.items.map((i) => i.id)).toContain('greatWinds');
  });

  it('seven pairs only as a house rule', () => {
    const i = input('1122m3344p5566s77z', '7z');
    expect(evaluateHk(i, R)).toBeNull();
    const s = evaluateHk(i, { ...R, sevenPairs: true })!;
    expect(s.items.map((x) => x.id).sort()).toEqual(['noFlowers', 'sevenPairs']);
  });

  it('situational faan', () => {
    const base = '123m 456m 234p 789s 55p';
    expect(ids(input(base, '5p', { selfDraw: true, from: null, kongReplacement: 1 }))).toContain('kongWin');
    expect(evaluateHk(input(base, '5p', { selfDraw: true, from: null, kongReplacement: 2 }), R)!.value).toBe(10);
    expect(ids(input(base, '5p', { robbingKong: true }))).toContain('robbingKong');
    expect(ids(input(base, '5p', { lastTile: true }))).toContain('lastTile');
    expect(evaluateHk(input(base, '5p', { heavenly: true, selfDraw: true, from: null }), R)!.limit).toBe(true);
  });

  it('flower wins need no hand', () => {
    expect(evaluateHk(input('1m', '1m', { flowerWin: 'eight' }), R)!.value).toBe(10);
    expect(evaluateHk(input('1m', '1m', { flowerWin: 'sevenRobOne' }), R)!.value).toBe(3);
  });
});

describe('HK payouts', () => {
  it('half-spicy and full-spicy tables', () => {
    expect([3, 4, 5, 6, 7, 8, 9, 10].map((f) => tablePoints(f, R))).toEqual([8, 16, 24, 32, 48, 64, 96, 128]);
    expect(tablePoints(13, R)).toBe(128); // capped at 10 faan
    expect(tablePoints(13, { ...R, maxFaan: 13 })).toBe(384);
    expect(tablePoints(6, { ...R, spicy: 'full' })).toBe(64);
  });

  const threeFaan = input('123m 456m 234p 789s 55p', '5p', { seat: 0, from: 2 });
  it('半銃: discarder pays half, the others a quarter', () => {
    const s = evaluateHk(threeFaan, R)!;
    expect(settleHk(threeFaan, s, R).deltas).toEqual([8, -2, -4, -2]);
  });
  it('全銃: the discarder pays it all', () => {
    const rules = { ...R, payment: 'fullGun' as const };
    expect(settleHk(threeFaan, evaluateHk(threeFaan, rules)!, rules).deltas).toEqual([8, 0, -8, 0]);
  });
  it('self-draw: everyone pays half (the winner takes 1.5×)', () => {
    const i = { ...threeFaan, selfDraw: true, from: null };
    const s = evaluateHk(i, R)!; // 4 faan → 16
    expect(settleHk(i, s, R).deltas).toEqual([24, -8, -8, -8]);
  });

  it('九張包: discarding into a one-suit hand showing three melds', () => {
    const melds = [meld('chi', '1m', 3, 0), meld('pong', '5m', 2, 1), meld('chi', '7m', 3, 2)];
    const i = input('234m 99m', '9m', { melds, from: 1 });
    const s = evaluateHk(i, R)!;
    expect(liabilityFor(i, s, R)?.rule).toBe('九張包');
    const d = settleHk(i, s, R).deltas;
    expect(d[1]).toBe(-tablePoints(s.value, R));
    expect(d[2]).toBe(0);
  });

  it('十二張包自摸: the feeder of the fourth meld pays for a self-drawn pure hand', () => {
    const melds = [meld('chi', '1m', 3, 0), meld('pong', '5m', 2, 1), meld('chi', '7m', 3, 2), meld('pong', '2m', 1, 3)];
    const i = input('99m', '9m', { melds, selfDraw: true, from: null });
    const s = evaluateHk(i, R)!;
    const st = settleHk(i, s, R);
    expect(st.liabilityRule).toBe('十二張包自摸');
    expect(st.deltas[1]).toBe(-1.5 * tablePoints(s.value, R));
  });

  it('包大三元: feeding the third dragon pong', () => {
    const melds = [meld('pong', '5z', 2, 0), meld('pong', '6z', 3, 1), meld('pong', '7z', 1, 2)];
    const i = input('123m 99m', '9m', { melds, selfDraw: true, from: null });
    const st = settleHk(i, evaluateHk(i, R)!, R);
    expect(st.liable).toBe(1);
  });

  it('五子包生: an unseen discard late in the hand', () => {
    const i = input('123m 456m 234p 789s 55p', '5p', { from: 2, wallLeft: 4, discardUnseen: true });
    expect(settleHk(i, evaluateHk(i, R)!, R).liabilityRule).toBe('五子包生');
  });

  it('no liability under 全銃', () => {
    const i = input('123m 456m 234p 789s 55p', '5p', { from: 2, wallLeft: 4, discardUnseen: true });
    const rules = { ...R, payment: 'fullGun' as const };
    expect(liabilityFor(i, evaluateHk(i, rules)!, rules)).toBeNull();
  });
});
