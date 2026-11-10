import { describe, expect, it } from 'vitest';
import { blankWinInput } from '../engine';
import { idsForKinds, parseKinds } from '../tiles';
import type { MeldFact, WinInput } from './index';
import { DEFAULT_RIICHI_RULES, basePoints, evaluateRiichi, payments, settleRiichi } from './riichi';

const R = DEFAULT_RIICHI_RULES;
const k = (t: string) => parseKinds(t)[0]!;

function input(concealed: string, win: string, o: Partial<WinInput> = {}): WinInput {
  const kinds = parseKinds(concealed);
  return blankWinInput({
    seat: 1,
    seatWind: 1, // South seat, East round
    prevailing: 0,
    dealer: 0,
    concealed: kinds,
    concealedIds: idsForKinds(kinds, new Set([16, 52, 88])), // no red fives unless asked
    winTile: k(win),
    melds: [],
    from: 2,
    ...o,
  });
}
const meld = (type: MeldFact['type'], kind: string, from: number | null = 3, order = 0): MeldFact => ({
  type,
  kind: k(kind),
  concealed: from === null,
  from,
  order,
  tiles: idsForKinds(type === 'chi' ? [k(kind), k(kind) + 1, k(kind) + 2] : new Array(type === 'kong' ? 4 : 3).fill(k(kind)), new Set([16, 52, 88])),
});
const ids = (i: WinInput) => evaluateRiichi(i, R)?.items.map((x) => x.id).sort();

describe('points', () => {
  const ron = (han: number, fu: number, dealer = false) => payments(basePoints(han, fu, 0, R).base, dealer, false).ron;
  it('matches the standard table', () => {
    expect(ron(1, 30)).toBe(1000);
    expect(ron(2, 30)).toBe(2000);
    expect(ron(3, 30)).toBe(3900);
    expect(ron(3, 40)).toBe(5200);
    expect(ron(4, 30)).toBe(7700); // no kiriage
    expect(ron(2, 25)).toBe(1600);
    expect(ron(3, 30, true)).toBe(5800);
    expect(ron(5, 30)).toBe(8000);
    expect(ron(6, 30)).toBe(12000);
    expect(ron(8, 30)).toBe(16000);
    expect(ron(11, 30)).toBe(24000);
    expect(ron(13, 30)).toBe(32000);
    expect(ron(4, 40)).toBe(8000); // base caps at mangan
    const t = payments(basePoints(3, 20, 0, R).base, false, true);
    expect([t.other, t.dealer]).toEqual([700, 1300]);
    expect(payments(basePoints(4, 30, 0, R).base, true, true).other).toBe(3900);
    expect(payments(8000, false, false).ron).toBe(32000);
  });
});

describe('yaku', () => {
  it('pinfu on a two-sided wait; not on an edge wait', () => {
    const s = evaluateRiichi(input('123m 456m 789p 234s 55p', '4s'), R)!;
    expect(s.items.map((i) => i.id)).toEqual(['pinfu']);
    expect([s.han, s.fu]).toEqual([1, 30]);
    // 12s waiting on 3s: edge wait, no pinfu, no yaku.
    expect(evaluateRiichi(input('123m 456m 789p 123s 55p', '3s'), R)!.raw).toBe(0);
  });

  it('riichi + tsumo + pinfu = 3 han 20 fu (700/1300)', () => {
    const s = evaluateRiichi(input('123m 456m 789p 234s 55p', '4s', { riichi: 1, selfDraw: true, from: null }), R)!;
    expect(s.items.map((i) => i.id).sort()).toEqual(['pinfu', 'riichi', 'tsumo']);
    expect([s.han, s.fu]).toEqual([3, 20]);
    expect(s.summary).toContain('700/1,300');
  });

  it('open tanyao (kuitan) and an open hand with no yaku', () => {
    const open = input('567p 345s 678s 22p', '2p', { melds: [meld('chi', '2m')] });
    const s = evaluateRiichi(open, R)!;
    expect(s.items.map((i) => i.id)).toEqual(['tanyao']);
    expect(s.fu).toBe(30);
    expect(evaluateRiichi(open, { ...R, kuitan: false })!.raw).toBe(0);
    expect(evaluateRiichi(input('567p 345s 678s 22p', '2p', { melds: [meld('chi', '1m')] }), R)!.raw).toBe(0);
  });

  it('value pongs count seat and round wind', () => {
    expect(ids(input('234m 567p 345s 22p', '2p', { melds: [meld('pong', '7z')] }))).toEqual(['yakuhai']);
    const doubleEast = evaluateRiichi(input('234m 567p 345s 22p', '2p', { seatWind: 0, seat: 0, melds: [meld('pong', '1z')] }), R)!;
    expect(doubleEast.items.find((i) => i.id === 'yakuhai')!.value).toBe(2);
  });

  it('chiitoitsu is 25 fu', () => {
    const s = evaluateRiichi(input('11m 33m 55p 77p 22s 44s 66z', '6z'), R)!;
    expect(s.items.map((i) => i.id)).toEqual(['chiitoitsu']);
    expect([s.han, s.fu]).toEqual([2, 25]);
  });

  it('suuankou on a tsumo; toitoi + sanankou on a shanpon ron', () => {
    const hand = '111m 333p 555s 999m 77z';
    expect(ids(input(hand, '9m', { selfDraw: true, from: null }))).toEqual(['suuankou']);
    const ron = evaluateRiichi(input(hand, '9m'), R)!;
    expect(ron.items.map((i) => i.id).sort()).toEqual(['sanankou', 'toitoi']);
    expect(evaluateRiichi(input(hand, '7z'), R)!.items[0]!.id).toBe('suuankou'); // tanki
  });

  it('yakuman', () => {
    expect(ids(input('19m19p19s1234567z1m', '1m'))).toEqual(['kokushi']);
    expect(ids(input('555z 666z 777z 234p 99s', '9s'))).toEqual(['daisangen']);
    expect(ids(input('1112345678999m 5m', '5m'))).toEqual(['chuuren']);
    expect(ids(input('234s 666s 888s 666z 22s', '2s'))).toEqual(['ryuuiisou']);
    expect(ids(input('123m 456m 789p 234s 55p', '4s', { firstDraw: true, seat: 0, selfDraw: true, from: null }))).toEqual(['tenhou']);
  });

  it('sanshoku, ittsu, chanta, junchan, flushes', () => {
    expect(ids(input('123m 123p 123s 789m 55z', '5z'))).toEqual(['chanta', 'sanshoku']);
    expect(ids(input('123m 456m 789m 234p 99s', '9s'))).toEqual(['ittsu']);
    // 78s waiting on 6s or 9s is two-sided, so pinfu too.
    expect(ids(input('123m 789m 123p 789s 99s', '9s'))).toEqual(['junchan', 'pinfu']);
    expect(ids(input('123m 456m 789m 222m 55m', '5m'))).toContain('chinitsu');
    expect(ids(input('123m 456m 789m 555z 11z', '1z'))).toEqual(['honitsu', 'ittsu', 'yakuhai'].sort());
  });

  it('dora count only with a yaku; red fives and ura dora', () => {
    const base = input('123m 456m 789p 234s 55p', '4s', { dora: [k('5p')] });
    expect(evaluateRiichi(base, R)!.han).toBe(3); // pinfu + 2 dora
    const red = input('123m 456m 789p 234s 55p', '4s', { concealedIds: [...idsForKinds(parseKinds('123m 4m 6m 789p 234s'), new Set([16])), 16, 52, 53] });
    // 5m red (16), 5p red (52), 5p (53): two red fives.
    expect(evaluateRiichi({ ...red, concealed: parseKinds('123m 456m 789p 234s 55p') }, R)!.items.find((i) => i.id === 'aka')!.value).toBe(2);
    const ura = input('123m 456m 789p 234s 55p', '4s', { riichi: 1, uraDora: [k('5p')] });
    expect(evaluateRiichi(ura, R)!.items.find((i) => i.id === 'ura')!.value).toBe(2);
    expect(evaluateRiichi(input('123m 456m 789p 123s 55p', '3s', { dora: [k('5p')] }), R)!.raw).toBe(0);
  });

  it('fu: closed ron with a closed terminal pong and a kanchan', () => {
    // 20 + 10 menzen ron + 8 closed 111m + 2 kanchan = 40; riichi for the yaku.
    const s = evaluateRiichi(input('111m 456p 789p 246s 55s', '4s', { riichi: 1, concealed: parseKinds('111m 456p 789p 234s 55s') }), R)!;
    expect(s.fu).toBe(40);
  });
});

describe('settlement', () => {
  it('ron with honba and sticks', () => {
    const i = input('123m 456m 789p 234s 55p', '4s', { honba: 2, sticks: 1 });
    const st = settleRiichi(i, evaluateRiichi(i, R)!, R);
    expect(st.deltas).toEqual([0, 1000 + 600 + 1000, -1600, 0]);
  });
  it('non-dealer tsumo splits 2:1 with the dealer', () => {
    const i = input('123m 456m 789p 234s 55p', '4s', { riichi: 1, selfDraw: true, from: null, honba: 1 });
    const st = settleRiichi(i, evaluateRiichi(i, R)!, R);
    expect(st.deltas).toEqual([-1400, 3000, -800, -800]);
  });
  it('pao: whoever fed the third dragon pays for a self-drawn daisangen', () => {
    const melds = [meld('pong', '5z', 3, 0), meld('pong', '6z', 2, 1), meld('pong', '7z', 2, 2)];
    const i = input('234p 99s', '9s', { melds, selfDraw: true, from: null });
    const st = settleRiichi(i, evaluateRiichi(i, R)!, R);
    expect(st.liable).toBe(2);
    expect(st.deltas).toEqual([0, 32000, -32000, 0]);
  });
});
