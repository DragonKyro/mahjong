import { describe, it, expect } from 'vitest';
import { Hand } from './Hand';
import { SuitTile, Suit } from '@core/tiles/SuitTile';
import { HonorTile, Wind, Dragon } from '@core/tiles/HonorTile';
import { BonusTile } from '@core/tiles/BonusTile';
import { Pong } from '@core/melds/Pong';
import { Kong } from '@core/melds/Kong';

describe('Hand', () => {
  it('keeps concealed tiles sorted as they are added', () => {
    const h = new Hand();
    h.add(new SuitTile(Suit.Bamboo, 5));
    h.add(new SuitTile(Suit.Character, 9));
    h.add(new HonorTile(Wind.East));
    h.add(new SuitTile(Suit.Character, 1));
    expect(h.concealed.map((t) => t.toString())).toEqual(['1m', '9m', '5s', 'E']);
  });

  it('routes bonus tiles to the bonus pile, not the concealed hand', () => {
    const h = new Hand();
    h.add(new SuitTile(Suit.Character, 3));
    h.add(new BonusTile('flower', 1));
    expect(h.concealed.map((t) => t.toString())).toEqual(['3m']);
    expect(h.bonuses.map((t) => t.toString())).toEqual(['F1']);
  });

  it('addAll inserts every tile', () => {
    const h = new Hand();
    h.addAll([
      new SuitTile(Suit.Character, 3),
      new SuitTile(Suit.Character, 3),
      new BonusTile('season', 2),
    ]);
    expect(h.concealed.length).toBe(2);
    expect(h.bonuses.length).toBe(1);
  });

  it('remove takes a matching tile and throws when absent', () => {
    const h = new Hand();
    h.add(new SuitTile(Suit.Character, 3));
    h.add(new SuitTile(Suit.Character, 3));
    const removed = h.remove(new SuitTile(Suit.Character, 3));
    expect(removed.toString()).toBe('3m');
    expect(h.countOf(new SuitTile(Suit.Character, 3))).toBe(1);
    h.remove(new SuitTile(Suit.Character, 3));
    expect(() => h.remove(new SuitTile(Suit.Character, 3))).toThrow(/not in/);
  });

  it('has and countOf reflect the concealed portion only', () => {
    const h = new Hand();
    h.add(new HonorTile(Dragon.Red));
    h.add(new HonorTile(Dragon.Red));
    expect(h.has(new HonorTile(Dragon.Red))).toBe(true);
    expect(h.countOf(new HonorTile(Dragon.Red))).toBe(2);
    expect(h.has(new HonorTile(Dragon.Green))).toBe(false);
  });

  it('size counts concealed + melded toward 14 (kongs contribute 3, not 4)', () => {
    const h = new Hand();
    // 4 concealed tiles
    h.add(new SuitTile(Suit.Character, 1));
    h.add(new SuitTile(Suit.Character, 2));
    h.add(new SuitTile(Suit.Character, 3));
    h.add(new SuitTile(Suit.Character, 4));
    expect(h.size()).toBe(4);

    // Expose a pong (contributes 3)
    h.exposeMeld(
      new Pong(
        [new HonorTile(Dragon.Red), new HonorTile(Dragon.Red), new HonorTile(Dragon.Red)],
        { concealed: true },
      ),
    );
    expect(h.size()).toBe(7);

    // Expose a kong (contributes 3, the 4th was a replacement draw)
    h.exposeMeld(
      new Kong(
        [
          new SuitTile(Suit.Bamboo, 9),
          new SuitTile(Suit.Bamboo, 9),
          new SuitTile(Suit.Bamboo, 9),
          new SuitTile(Suit.Bamboo, 9),
        ],
        'concealed',
      ),
    );
    expect(h.size()).toBe(10);
  });
});
