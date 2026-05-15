import { describe, it, expect } from 'vitest';
import { HKOldStyleWinValidator } from './HKOldStyleWinValidator';
import { DEFAULT_RULES } from './RulesConfig';
import { SuitTile, Suit } from '@core/tiles/SuitTile';
import { HonorTile, Wind, Dragon } from '@core/tiles/HonorTile';
import type { WinContext } from '@core/game/types';
import type { Tile } from '@core/tiles/Tile';

const m = (r: number) => new SuitTile(Suit.Character, r as 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9);
const p = (r: number) => new SuitTile(Suit.Circle, r as 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9);
const s = (r: number) => new SuitTile(Suit.Bamboo, r as 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9);
const E = () => new HonorTile(Wind.East);
const Red = () => new HonorTile(Dragon.Red);
const Green = () => new HonorTile(Dragon.Green);
const White = () => new HonorTile(Dragon.White);

const context: WinContext = {
  winnerSeat: Wind.East,
  prevailingWind: Wind.East,
  fromSeat: Wind.South,
  fromKongReplacement: false,
  fromKongRob: false,
  fromLastTile: false,
  bonusTiles: [],
};

describe('HKOldStyleWinValidator', () => {
  const v = new HKOldStyleWinValidator(DEFAULT_RULES);

  it('rejects a structurally complete hand that scores below 3 faan (雞胡)', () => {
    // All chi (1 faan) + no other faan triggers — below 3 faan minimum.
    const concealed: Tile[] = [
      m(1), m(2), m(3),
      m(4), m(5), m(6),
      p(7), p(8), p(9),
      s(2), s(3), s(4),
      p(5),
    ];
    expect(
      v.canWin({ concealed, winningTile: p(5), exposedMelds: [], context }),
    ).toBe(false);
  });

  it('accepts 大三元 (limit hand, well above 3 faan)', () => {
    const concealed: Tile[] = [
      Red(), Red(), Red(),
      Green(), Green(), Green(),
      White(), White(), White(),
      m(2), m(3), m(4),
      E(),
    ];
    expect(
      v.canWin({ concealed, winningTile: E(), exposedMelds: [], context }),
    ).toBe(true);
  });

  it('accepts 對對和 (3 faan, meets the minimum exactly)', () => {
    const concealed: Tile[] = [
      m(2), m(2), m(2),
      p(5), p(5), p(5),
      s(7), s(7), s(7),
      E(), E(),
      Red(), Red(),
    ];
    expect(
      v.canWin({ concealed, winningTile: Red(), exposedMelds: [], context }),
    ).toBe(true);
  });

  it('rejects a structurally invalid hand', () => {
    const concealed: Tile[] = [
      m(1), m(2), m(4), // gap — 1-2-4 isn't a chi
      p(4), p(5), p(6),
      s(7), s(8), s(9),
      E(), E(), E(),
      Red(),
    ];
    expect(
      v.canWin({ concealed, winningTile: Red(), exposedMelds: [], context }),
    ).toBe(false);
  });
});
