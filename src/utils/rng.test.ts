import { describe, it, expect } from 'vitest';
import { mulberry32, shuffleInPlace } from './rng';

describe('mulberry32', () => {
  it('produces values in [0, 1)', () => {
    const rng = mulberry32(42);
    for (let i = 0; i < 1000; i++) {
      const v = rng();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });

  it('is deterministic for the same seed', () => {
    const a = mulberry32(12345);
    const b = mulberry32(12345);
    for (let i = 0; i < 50; i++) {
      expect(a()).toBe(b());
    }
  });

  it('diverges for different seeds', () => {
    const a = mulberry32(1);
    const b = mulberry32(2);
    const first = [a(), a(), a()];
    const second = [b(), b(), b()];
    expect(first).not.toEqual(second);
  });
});

describe('shuffleInPlace', () => {
  it('preserves all elements (permutation)', () => {
    const input = Array.from({ length: 100 }, (_, i) => i);
    const shuffled = shuffleInPlace([...input], mulberry32(1));
    expect(shuffled.slice().sort((a, b) => a - b)).toEqual(input);
  });

  it('produces identical orderings for the same seed', () => {
    const a = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
    const b = [...a];
    shuffleInPlace(a, mulberry32(7));
    shuffleInPlace(b, mulberry32(7));
    expect(a).toEqual(b);
  });

  it('typically changes the order', () => {
    const input = Array.from({ length: 20 }, (_, i) => i);
    const shuffled = shuffleInPlace([...input], mulberry32(99));
    expect(shuffled).not.toEqual(input);
  });

  it('handles empty and single-element arrays', () => {
    expect(shuffleInPlace<number>([], mulberry32(1))).toEqual([]);
    expect(shuffleInPlace([42], mulberry32(1))).toEqual([42]);
  });
});
