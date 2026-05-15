import { describe, it, expect } from 'vitest';
import { Ukeire } from './Ukeire';
import { SuitTile, Suit } from '@core/tiles/SuitTile';
import { HonorTile, Wind, Dragon } from '@core/tiles/HonorTile';
import type { Tile } from '@core/tiles/Tile';

const m = (r: number) => new SuitTile(Suit.Character, r as 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9);
const p = (r: number) => new SuitTile(Suit.Circle, r as 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9);
const s = (r: number) => new SuitTile(Suit.Bamboo, r as 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9);
const E = () => new HonorTile(Wind.East);
const W = () => new HonorTile(Wind.West);
const Red = () => new HonorTile(Dragon.Red);

describe('Ukeire.analyzeAll', () => {
  it('produces one analysis per distinct discard candidate', () => {
    const hand: Tile[] = [
      m(1), m(2), m(3),
      p(4), p(5), p(6),
      s(7), s(8), s(9),
      E(), E(),
      p(2), p(3),
      W(),
    ];
    const analyses = Ukeire.analyzeAll(hand, 0, hand);
    // Distinct tile-types in hand
    const distinctKinds = new Set(hand.map((t) => t.toString())).size;
    expect(analyses.length).toBe(distinctKinds);
  });

  it('every discard from a 14-tile winning hand leaves a tenpai (shanten 0) hand', () => {
    // 13 tiles can't be a winning configuration, so discarding ALWAYS drops at
    // least to tenpai. Every analysis should therefore be shanten 0.
    const hand: Tile[] = [
      m(1), m(2), m(3),
      m(4), m(5), m(6),
      p(7), p(8), p(9),
      s(2), s(3), s(4),
      Red(), Red(),
    ];
    const analyses = Ukeire.analyzeAll(hand, 0, hand);
    for (const a of analyses) {
      expect(a.shanten).toBe(0);
    }
  });

  it('identifies the optimal discard (highest acceptance at lowest shanten)', () => {
    // Tenpai 13 + W floater. Discarding W keeps tenpai with the full original acceptance.
    // Any other discard would worsen shanten OR reduce acceptance.
    const hand: Tile[] = [
      m(1), m(2), m(3),
      p(7), p(8), p(9),
      s(2), s(3), s(4),
      E(), E(),
      p(2), p(3),
      W(),
    ];
    const analyses = Ukeire.analyzeAll(hand, 0, hand);
    const best = Ukeire.optimalDiscard(analyses);
    expect(best.discard.toString()).toBe('W');
    expect(best.shanten).toBe(0);
    expect(best.acceptance).toBeGreaterThan(0);
  });

  it('counts only unseen tiles in acceptance', () => {
    // Tenpai waiting on Red pair: hand has 1 Red, so 3 Reds remain (unseen).
    // If "visible" already shows 2 more Reds, acceptance for the Red wait drops to 1.
    const hand: Tile[] = [
      m(1), m(2), m(3),
      m(4), m(5), m(6),
      p(7), p(8), p(9),
      s(2), s(3), s(4),
      Red(),
    ];
    const baseAnalyses = Ukeire.analyzeAll(hand, 0, hand);
    const baseRedAcceptance = baseAnalyses[0]?.waits.find((w) => w.tile.equals(Red()))?.remaining ?? 0;
    expect(baseRedAcceptance).toBe(3);

    // Now mark 2 extra Reds as visible (e.g., in opponents' discard piles).
    const visibleExtra: Tile[] = [...hand, Red(), Red()];
    const adjusted = Ukeire.analyzeAll(hand, 0, visibleExtra);
    const adjustedRedAcceptance = adjusted[0]?.waits.find((w) => w.tile.equals(Red()))?.remaining ?? 0;
    expect(adjustedRedAcceptance).toBe(1);
  });
});

describe('Ukeire.optimalDiscard', () => {
  it('prefers lower shanten over higher acceptance', () => {
    const analyses = [
      { discard: m(5), shanten: 1, acceptance: 30, waits: [] },
      { discard: p(5), shanten: 0, acceptance: 4, waits: [] },
    ];
    const best = Ukeire.optimalDiscard(analyses);
    expect(best.discard.equals(p(5))).toBe(true);
  });

  it('breaks ties on equal shanten by maximum acceptance', () => {
    const analyses = [
      { discard: m(5), shanten: 0, acceptance: 4, waits: [] },
      { discard: p(5), shanten: 0, acceptance: 8, waits: [] },
    ];
    const best = Ukeire.optimalDiscard(analyses);
    expect(best.discard.equals(p(5))).toBe(true);
  });
});
