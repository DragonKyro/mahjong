import { describe, it, expect } from 'vitest';
import { SuitTile, Suit } from './SuitTile';
import { HonorTile, Wind } from './HonorTile';

describe('SuitTile', () => {
  it('formats toString as `<rank><suit>`', () => {
    expect(new SuitTile(Suit.Character, 3).toString()).toBe('3m');
    expect(new SuitTile(Suit.Circle, 9).toString()).toBe('9p');
    expect(new SuitTile(Suit.Bamboo, 1).toString()).toBe('1s');
  });

  it('renders unicode glyphs correctly', () => {
    expect(new SuitTile(Suit.Character, 1).toUnicode()).toBe('🀇');
    expect(new SuitTile(Suit.Character, 9).toUnicode()).toBe('🀏');
    expect(new SuitTile(Suit.Bamboo, 1).toUnicode()).toBe('🀐');
    expect(new SuitTile(Suit.Circle, 1).toUnicode()).toBe('🀙');
  });

  it('equals same suit and rank, ignoring object identity', () => {
    const a = new SuitTile(Suit.Character, 3);
    const b = new SuitTile(Suit.Character, 3);
    const c = new SuitTile(Suit.Character, 4);
    const d = new SuitTile(Suit.Circle, 3);
    expect(a.equals(b)).toBe(true);
    expect(a.equals(c)).toBe(false);
    expect(a.equals(d)).toBe(false);
  });

  it('does not equal honor tiles even with similar codes', () => {
    expect(new SuitTile(Suit.Character, 1).equals(new HonorTile(Wind.East))).toBe(false);
  });

  it('sort key orders suits Character < Circle < Bamboo, then by rank', () => {
    const m1 = new SuitTile(Suit.Character, 1);
    const m9 = new SuitTile(Suit.Character, 9);
    const p1 = new SuitTile(Suit.Circle, 1);
    const s9 = new SuitTile(Suit.Bamboo, 9);
    expect(m1.sortKey()).toBe(0);
    expect(m9.sortKey()).toBe(8);
    expect(p1.sortKey()).toBe(9);
    expect(s9.sortKey()).toBe(26);
    expect(m1.compareTo(m9)).toBeLessThan(0);
    expect(m9.compareTo(p1)).toBeLessThan(0);
  });

  it('isTerminal is true only for ranks 1 and 9', () => {
    for (let r = 1; r <= 9; r++) {
      const t = new SuitTile(Suit.Character, r as 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9);
      expect(t.isTerminal()).toBe(r === 1 || r === 9);
      expect(t.isSimple()).toBe(r !== 1 && r !== 9);
    }
  });

  it('isSuit type-guards correctly', () => {
    const t: SuitTile | HonorTile = new SuitTile(Suit.Character, 1);
    if (t.isSuit()) {
      expect(t.rank).toBe(1);
    } else {
      throw new Error('expected suit');
    }
  });
});
