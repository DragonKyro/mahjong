import { describe, expect, it } from 'vitest';
import { blankWinInput } from '../engine';
import { parseKinds } from '../tiles';
import type { MeldFact, WinInput } from './index';
import { DEFAULT_TAIWAN_RULES, evaluateTaiwan, settleTaiwan } from './taiwan';

const R = DEFAULT_TAIWAN_RULES;
const k = (t: string) => parseKinds(t)[0]!;

function input(concealed: string, win: string, o: Partial<WinInput> = {}): WinInput {
  return blankWinInput({
    seat: 1,
    seatWind: 1,
    prevailing: 0,
    dealer: 0,
    concealed: parseKinds(concealed),
    winTile: k(win),
    melds: [],
    bonus: parseKinds('1f'), // a flower that isn't South's
    from: 2,
    ...o,
  });
}
const meld = (type: MeldFact['type'], kind: string, from: number | null = 2, order = 0): MeldFact => ({ type, kind: k(kind), concealed: from === null, from, order, tiles: [] });
const ids = (i: WinInput) => evaluateTaiwan(i, R)?.items.map((x) => x.id).sort();

describe('Taiwan tai', () => {
  // 17 tiles: five sets + a pair.
  const chows = '123m 456m 789p 234s 678s 55p';

  it('平胡: five chows, no honors or flowers, two-sided wait on a discard', () => {
    expect(ids(input(chows, '4s', { bonus: [] }))).toEqual(['allChows', 'concealed'].sort());
    expect(ids(input(chows, '4s'))).toEqual(['concealed']); // has a flower
  });

  it('門清自摸 replaces 門清 + 自摸; 獨聽 on a single wait', () => {
    expect(ids(input(chows, '4s', { selfDraw: true, from: null }))).toEqual(['concealedSelfDraw']);
    // Waiting on 5p alone (單吊 with everything else fixed): 獨聽.
    expect(ids(input(chows, '5p'))).toEqual(['concealed', 'singleWait'].sort());
  });

  it('a hand with no tai still wins (屁胡)', () => {
    const s = evaluateTaiwan(input('456m 789p 234s 678s 55p', '4s', { melds: [meld('chi', '1m')] }), R)!;
    expect(s.value).toBe(0);
  });

  it('pongs, flushes and honors', () => {
    // Waiting on 2s alone, so 獨聽 too.
    expect(ids(input('111m 333p 555s 777m 999p 22s', '2s', { melds: [] }))).toEqual(['allPongs', 'concealed', 'fiveConcealed', 'singleWait'].sort());
    expect(ids(input('123m 456m 789m 234m 678m 55m', '5m'))).toContain('allOneSuit');
    expect(ids(input('123m 456m 789m 555z 666z 77z', '7z'))).toEqual(['concealed', 'mixedOneSuit', 'singleWait', 'smallDragons'].sort());
    expect(evaluateTaiwan(input('555z 666z 777z 123m 456p 99s', '9s'), R)!.items.find((i) => i.id === 'greatDragons')!.value).toBe(8);
  });

  it('flowers: seat flower and a full set', () => {
    expect(ids(input(chows, '4s', { bonus: parseKinds('2f') }))).toContain('seatFlower');
    expect(ids(input(chows, '4s', { bonus: parseKinds('1234f') }))).toContain('flowerSet');
  });

  it('嚦咕嚦咕: seven pairs and a pong', () => {
    expect(ids(input('11m 22m 33p 44p 55s 66s 77z 111z', '7z'))).toContain('liguLigu');
  });

  it('dealer tai on dealer wins and dealer payments', () => {
    const dealerWin = evaluateTaiwan(input(chows, '4s', { seat: 0, seatWind: 0, streak: 1, bonus: [] }), R)!;
    // 門清 1 + 平胡 2 + 莊家 1 + 連一拉一 2 = 6.
    expect(dealerWin.value).toBe(6);
    // Non-dealer self-draws 門清自摸 (3 tai): the dealer pays the dealer tai on top.
    const i = input(chows, '4s', { selfDraw: true, from: null, streak: 1 });
    const st = settleTaiwan(i, evaluateTaiwan(i, R)!, R);
    expect(st.deltas).toEqual([-(30 + 10 * 6), 60 + 60 + 90, -60, -60]);
  });

  it('special hands', () => {
    expect(ids(input(chows, '4s', { firstDraw: true, seat: 0, selfDraw: true, from: null }))).toEqual(['dealer', 'heavenly'].sort());
    expect(ids(input(chows, '4s', { beforeFirstDraw: true }))).toEqual(['human']);
  });
});
