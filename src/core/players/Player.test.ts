import { describe, it, expect } from 'vitest';
import { HumanPlayer } from './HumanPlayer';
import { Wind } from '@core/tiles/HonorTile';
import { SuitTile, Suit } from '@core/tiles/SuitTile';

describe('Player (via HumanPlayer)', () => {
  it('stores name, seat wind, and starts with empty hand/discards/score', () => {
    const p = new HumanPlayer('Anna', Wind.East);
    expect(p.name).toBe('Anna');
    expect(p.seatWind).toBe(Wind.East);
    expect(p.score).toBe(0);
    expect(p.discards).toEqual([]);
    expect(p.hand.concealed).toEqual([]);
  });

  it('recordDiscard appends to the discard pile in order', () => {
    const p = new HumanPlayer('Anna', Wind.East);
    p.recordDiscard(new SuitTile(Suit.Character, 3));
    p.recordDiscard(new SuitTile(Suit.Circle, 7));
    expect(p.discards.map((t) => t.toString())).toEqual(['3m', '7p']);
  });

  it('hand mutations are visible through the public hand reference', () => {
    const p = new HumanPlayer('Anna', Wind.East);
    p.hand.add(new SuitTile(Suit.Bamboo, 5));
    expect(p.hand.concealed.map((t) => t.toString())).toEqual(['5s']);
  });
});
