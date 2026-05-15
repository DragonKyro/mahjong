import { describe, it, expect } from 'vitest';
import { DefensiveAI } from './DefensiveAI';
import { SuitTile, Suit } from '@core/tiles/SuitTile';
import { HonorTile, Wind, Dragon } from '@core/tiles/HonorTile';
import type { Tile } from '@core/tiles/Tile';
import type { PlayerView } from '@core/game/types';

const m = (r: number) => new SuitTile(Suit.Character, r as 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9);
const p = (r: number) => new SuitTile(Suit.Circle, r as 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9);
const s = (r: number) => new SuitTile(Suit.Bamboo, r as 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9);
const E = () => new HonorTile(Wind.East);
const S = () => new HonorTile(Wind.South);
const W = () => new HonorTile(Wind.West);
const Red = () => new HonorTile(Dragon.Red);

function viewWith(opts: {
  hand: Tile[];
  southDiscards?: Tile[];
  westDiscards?: Tile[];
  northDiscards?: Tile[];
}): PlayerView {
  return {
    self: {
      seatWind: Wind.East,
      hand: opts.hand,
      melds: [],
      bonuses: [],
      discards: [],
    },
    others: [
      {
        seatWind: Wind.South,
        melds: [],
        bonuses: [],
        discards: opts.southDiscards ?? [],
        handSize: 13,
      },
      {
        seatWind: Wind.West,
        melds: [],
        bonuses: [],
        discards: opts.westDiscards ?? [],
        handSize: 13,
      },
      {
        seatWind: Wind.North,
        melds: [],
        bonuses: [],
        discards: opts.northDiscards ?? [],
        handSize: 13,
      },
    ],
    prevailingWind: Wind.East,
    dealer: Wind.East,
    wallRemaining: 70,
    lastDiscard: null,
  };
}

describe('DefensiveAI.chooseAction', () => {
  const ai = new DefensiveAI();

  it('declares a self-draw win when the 14-tile hand is winning', () => {
    const hand = [
      m(1), m(2), m(3),
      m(4), m(5), m(6),
      p(7), p(8), p(9),
      s(2), s(3), s(4),
      Red(), Red(),
    ];
    const action = ai.chooseAction(viewWith({ hand }), Red());
    expect(action.kind).toBe('win');
  });

  it('prefers genbutsu (already-discarded by opponent) when multiple discards tie on shanten', () => {
    // 3 sets + EE pair + 3 isolated floaters (p7, W, S). All three floaters are
    // equivalent for shanten (each leaves a 1-shanten hand). DefensiveAI should
    // pick S because it's in South's discard pile = guaranteed safe vs South.
    const hand = [
      m(1), m(2), m(3),
      p(4), p(5), p(6),
      s(7), s(8), s(9),
      E(), E(),
      p(7), W(), S(),
    ];
    const action = ai.chooseAction(viewWith({ hand, southDiscards: [S()] }), S());
    expect(action.kind).toBe('discard');
    if (action.kind === 'discard') {
      expect(action.tile.toString()).toBe('S');
    }
  });

  it('falls back to a non-defensive discard when no safer option exists', () => {
    // Same shape but no opponent has discarded any of the floaters.
    const hand = [
      m(1), m(2), m(3),
      p(4), p(5), p(6),
      s(7), s(8), s(9),
      E(), E(),
      p(7), W(), S(),
    ];
    const action = ai.chooseAction(viewWith({ hand }), S());
    expect(action.kind).toBe('discard');
    if (action.kind === 'discard') {
      // No genbutsu → tiebreak by acceptance then sort-key. We just verify it's
      // one of the three equivalent floaters, not something that breaks a set.
      expect(['p7', 'W', 'S']).toContain(action.tile.toString());
    }
  });
});
