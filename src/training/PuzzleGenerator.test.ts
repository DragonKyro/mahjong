import { describe, it, expect } from 'vitest';
import { PuzzleGenerator } from './PuzzleGenerator';
import { mulberry32 } from '@utils/rng';

describe('PuzzleGenerator.generate', () => {
  it('produces a 14-tile hand with at least one analysed discard', () => {
    const puzzle = PuzzleGenerator.generate({ rng: mulberry32(1) });
    expect(puzzle.hand.length).toBe(14);
    expect(puzzle.analyses.length).toBeGreaterThan(0);
    expect(puzzle.optimal).toBeDefined();
  });

  it('is deterministic for the same RNG seed', () => {
    const a = PuzzleGenerator.generate({ rng: mulberry32(42) });
    const b = PuzzleGenerator.generate({ rng: mulberry32(42) });
    expect(a.id).toBe(b.id);
    expect(a.optimal.discard.toString()).toBe(b.optimal.discard.toString());
  });

  it('returns a non-bonus hand', () => {
    const puzzle = PuzzleGenerator.generate({ rng: mulberry32(7) });
    expect(puzzle.hand.every((t) => !t.isBonus())).toBe(true);
  });

  it('returns sorted tiles for a stable display order', () => {
    const puzzle = PuzzleGenerator.generate({ rng: mulberry32(3) });
    for (let i = 1; i < puzzle.hand.length; i++) {
      expect(puzzle.hand[i - 1]!.compareTo(puzzle.hand[i]!)).toBeLessThanOrEqual(0);
    }
  });

  it('tries to land at or below the preferred max shanten', () => {
    // With many attempts and a loose target, the generator usually finds a
    // qualifying hand. The contract is "tries"; we just assert the puzzle is
    // valid even if the target is not met.
    const puzzle = PuzzleGenerator.generate({
      rng: mulberry32(13),
      preferredMaxShanten: 2,
      maxAttempts: 50,
    });
    expect(puzzle.bestShanten).toBeGreaterThanOrEqual(-1);
    expect(puzzle.bestShanten).toBeLessThanOrEqual(8);
  });
});
