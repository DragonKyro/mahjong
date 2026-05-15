import { describe, it, expect } from 'vitest';
import { Shanten, tileToIndex, indexToTile } from './Shanten';
import { SuitTile, Suit } from '@core/tiles/SuitTile';
import { HonorTile, Wind, Dragon } from '@core/tiles/HonorTile';
import type { Tile } from '@core/tiles/Tile';

const m = (r: number) => new SuitTile(Suit.Character, r as 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9);
const p = (r: number) => new SuitTile(Suit.Circle, r as 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9);
const s = (r: number) => new SuitTile(Suit.Bamboo, r as 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9);
const E = () => new HonorTile(Wind.East);
const S = () => new HonorTile(Wind.South);
const W = () => new HonorTile(Wind.West);
const N = () => new HonorTile(Wind.North);
const Red = () => new HonorTile(Dragon.Red);
const Green = () => new HonorTile(Dragon.Green);
const White = () => new HonorTile(Dragon.White);

describe('tileToIndex / indexToTile', () => {
  it('round-trips every suit and honor tile', () => {
    for (let i = 0; i < 34; i++) {
      const tile = indexToTile(i);
      expect(tileToIndex(tile)).toBe(i);
    }
  });

  it('orders suits as m < p < s, then honors', () => {
    expect(tileToIndex(m(1))).toBe(0);
    expect(tileToIndex(m(9))).toBe(8);
    expect(tileToIndex(p(1))).toBe(9);
    expect(tileToIndex(s(9))).toBe(26);
    expect(tileToIndex(E())).toBe(27);
    expect(tileToIndex(White())).toBe(33);
  });
});

describe('Shanten.count — standard', () => {
  it('returns -1 for a winning 14-tile hand', () => {
    const hand = [
      m(1), m(2), m(3),
      m(4), m(5), m(6),
      p(7), p(8), p(9),
      s(2), s(3), s(4),
      Red(), Red(),
    ];
    expect(Shanten.count(hand, 0)).toBe(-1);
  });

  it('returns 0 for a tenpai 13-tile hand (4 sets + floater waiting on pair)', () => {
    const hand = [
      m(1), m(2), m(3),
      m(4), m(5), m(6),
      p(7), p(8), p(9),
      s(2), s(3), s(4),
      Red(), // floater — waiting on Red for the pair
    ];
    expect(Shanten.count(hand, 0)).toBe(0);
  });

  it('returns 0 for tenpai with a partial waiting for the 4th set', () => {
    const hand = [
      m(1), m(2), m(3),
      m(4), m(5), m(6),
      p(7), p(8), p(9),
      s(2), s(3), // partial waiting on 1s or 4s
      Red(), Red(), // pair
    ];
    expect(Shanten.count(hand, 0)).toBe(0);
  });

  it('returns 1 for a hand one exchange from tenpai', () => {
    const hand = [
      m(1), m(2), m(3),
      m(4), m(5), m(6),
      p(7), p(8), p(9),
      s(2), s(3), // partial
      s(8), Red(), // two floaters; need 1 of them to pair or to start a partial
    ];
    expect(Shanten.count(hand, 0)).toBe(1);
  });

  it('handles exposed melds (each meld reduces target by 1)', () => {
    // 1 exposed meld + 3 chi + pair from concealed = full winning shape.
    // With exposedSetCount=1 the algorithm targets 3 sets + 1 pair from concealed,
    // which this hand already completes → shanten -1.
    const hand = [
      m(1), m(2), m(3),
      p(4), p(5), p(6),
      s(7), s(8), s(9),
      Red(), Red(),
    ];
    expect(Shanten.count(hand, 1)).toBe(-1);
  });

  it('reports tenpai for a 10-tile hand with one exposed meld and a missing tile', () => {
    // 1 exposed meld + 2 complete chi + 1 partial + pair = 10 concealed; tenpai.
    const hand = [
      m(1), m(2), m(3),
      p(4), p(5), p(6),
      s(7), s(8), // partial waiting on 6s or 9s
      Red(), Red(),
    ];
    expect(Shanten.count(hand, 1)).toBe(0);
  });
});

describe('Shanten.count — 七對 (seven pairs)', () => {
  it('returns -1 for a complete 14-tile seven pairs hand', () => {
    const hand = [
      m(1), m(1),
      m(5), m(5),
      p(3), p(3),
      p(9), p(9),
      s(2), s(2),
      s(8), s(8),
      E(), E(),
    ];
    expect(Shanten.count(hand, 0)).toBe(-1);
  });

  it('returns 0 for a 13-tile tenpai seven pairs hand', () => {
    const hand = [
      m(1), m(1),
      m(5), m(5),
      p(3), p(3),
      p(9), p(9),
      s(2), s(2),
      s(8), s(8),
      E(), // singleton — waiting on a second E
    ];
    expect(Shanten.count(hand, 0)).toBe(0);
  });

  it('beats the standard shanten when the hand is closer to seven pairs', () => {
    // Hand of 6 pairs + 1 random: definitely closer to 七對 than to 4-set+pair.
    const hand = [
      m(1), m(1),
      m(5), m(5),
      p(3), p(3),
      p(9), p(9),
      s(2), s(2),
      s(8), s(8),
      E(),
    ];
    // Standard would give a higher number; 七對 gives 0 (need one more E for the 7th pair).
    expect(Shanten.count(hand, 0)).toBe(0);
  });
});

describe('Shanten.count — 十三么 (thirteen orphans)', () => {
  it('returns -1 for a winning 十三么 hand', () => {
    const hand = [
      m(1), m(1), m(9),
      p(1), p(9),
      s(1), s(9),
      E(), S(), W(), N(),
      Red(), Green(), White(),
    ];
    expect(Shanten.count(hand, 0)).toBe(-1);
  });

  it('returns 0 for tenpai 十三么 missing one type', () => {
    const hand = [
      m(1), m(9),
      p(1), p(9),
      s(1), s(9),
      E(), S(), W(), N(),
      Red(), Green(), White(),
      // 13 distinct orphans, missing a pair — tenpai waiting on any of them
    ];
    expect(Shanten.count(hand, 0)).toBe(0);
  });
});

describe('Shanten.bestDiscard', () => {
  it('picks the uniquely-best discard for a tenpai hand with one bad draw', () => {
    // Tenpai 13: 3 chi + pair + partial waiting on 1p or 4p.
    // Draw W (no connection to anything) → discarding W keeps tenpai;
    // any other discard worsens shanten.
    const hand: Tile[] = [
      m(1), m(2), m(3),
      p(7), p(8), p(9),
      s(2), s(3), s(4),
      E(), E(),
      p(2), p(3),
      W(),
    ];
    const { discard, shanten } = Shanten.bestDiscard(hand, 0);
    expect(discard.toString()).toBe('W');
    expect(shanten).toBe(0);
  });
});

describe('Shanten.waits', () => {
  it('returns the tiles that complete a tenpai hand', () => {
    // 4 sets + floater Red: tenpai waiting on Red for the pair.
    const hand = [
      m(1), m(2), m(3),
      m(4), m(5), m(6),
      p(7), p(8), p(9),
      s(2), s(3), s(4),
      Red(),
    ];
    const waits = Shanten.waits(hand, 0);
    expect(waits.length).toBeGreaterThan(0);
    expect(waits.some((t) => t.equals(Red()))).toBe(true);
  });

  it('returns empty array for a non-tenpai hand', () => {
    const hand = [
      m(1), m(2), m(4),
      m(5), m(7), m(8),
      p(1), p(3), p(5),
      s(2), s(4), s(6),
      E(),
    ];
    expect(Shanten.waits(hand, 0)).toEqual([]);
  });
});
