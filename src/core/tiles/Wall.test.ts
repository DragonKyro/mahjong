import { describe, it, expect } from 'vitest';
import { mulberry32 } from '@utils/rng';
import { Wall, TOTAL_TILES, DEAD_WALL_SIZE } from './Wall';
import { SuitTile, Suit } from './SuitTile';
import { HonorTile, Wind, Dragon } from './HonorTile';
import { BonusTile } from './BonusTile';
import type { Tile } from './Tile';

describe('Wall.buildFullSet', () => {
  const set = Wall.buildFullSet();

  it('contains exactly 144 tiles', () => {
    expect(set).toHaveLength(TOTAL_TILES);
  });

  it('contains four copies of every suit tile (108 total)', () => {
    const counts = new Map<string, number>();
    for (const t of set) {
      if (t.isSuit()) {
        counts.set(t.toString(), (counts.get(t.toString()) ?? 0) + 1);
      }
    }
    expect(counts.size).toBe(27); // 3 suits × 9 ranks
    for (const c of counts.values()) {
      expect(c).toBe(4);
    }
  });

  it('contains four copies of each wind and dragon (28 honor tiles)', () => {
    const honors = set.filter((t): t is HonorTile => t.isHonor());
    expect(honors).toHaveLength(28);
    const counts = new Map<string, number>();
    for (const t of honors) {
      counts.set(t.toString(), (counts.get(t.toString()) ?? 0) + 1);
    }
    expect(counts.size).toBe(7);
    for (const c of counts.values()) {
      expect(c).toBe(4);
    }
  });

  it('contains exactly 8 bonus tiles (4 flowers + 4 seasons), one of each', () => {
    const bonuses = set.filter((t): t is BonusTile => t.isBonus());
    expect(bonuses).toHaveLength(8);
    const unique = new Set(bonuses.map((b) => b.toString()));
    expect(unique.size).toBe(8);
  });
});

describe('Wall', () => {
  it('is deterministic given the same seed', () => {
    const a = new Wall(mulberry32(1));
    const b = new Wall(mulberry32(1));
    const drawnA: string[] = [];
    const drawnB: string[] = [];
    for (let i = 0; i < 20; i++) {
      drawnA.push(a.draw().toString());
      drawnB.push(b.draw().toString());
    }
    expect(drawnA).toEqual(drawnB);
  });

  it('differs across seeds', () => {
    const a = new Wall(mulberry32(1));
    const b = new Wall(mulberry32(2));
    const drawnA: string[] = [];
    const drawnB: string[] = [];
    for (let i = 0; i < 20; i++) {
      drawnA.push(a.draw().toString());
      drawnB.push(b.draw().toString());
    }
    expect(drawnA).not.toEqual(drawnB);
  });

  it('exposes exactly TOTAL_TILES - DEAD_WALL_SIZE live tiles', () => {
    const w = new Wall(mulberry32(99));
    expect(w.liveRemaining()).toBe(TOTAL_TILES - DEAD_WALL_SIZE);
    expect(w.deadRemaining()).toBe(DEAD_WALL_SIZE);
    expect(w.totalRemaining()).toBe(TOTAL_TILES);
  });

  it('decrements liveRemaining on each draw', () => {
    const w = new Wall(mulberry32(7));
    const before = w.liveRemaining();
    w.draw();
    expect(w.liveRemaining()).toBe(before - 1);
  });

  it('throws when the live wall is exhausted', () => {
    const w = new Wall(mulberry32(7));
    while (!w.isLiveExhausted()) w.draw();
    expect(() => w.draw()).toThrow(/exhausted/);
  });

  it('replacement draws come from the back and decrement deadRemaining', () => {
    const w = new Wall(mulberry32(7));
    const dead0 = w.deadRemaining();
    w.drawReplacement();
    expect(w.deadRemaining()).toBe(dead0 - 1);
  });

  it('throws when the dead wall is exhausted', () => {
    const w = new Wall(mulberry32(7));
    for (let i = 0; i < DEAD_WALL_SIZE; i++) w.drawReplacement();
    expect(() => w.drawReplacement()).toThrow(/exhausted/);
  });

  it('all 144 drawn tiles together form the complete set', () => {
    const w = new Wall(mulberry32(2024));
    const drawn: Tile[] = [];
    while (!w.isLiveExhausted()) drawn.push(w.draw());
    while (w.deadRemaining() > 0) drawn.push(w.drawReplacement());
    expect(drawn).toHaveLength(TOTAL_TILES);
    // Spot-check counts of a few tiles
    expect(drawn.filter((t) => t.equals(new SuitTile(Suit.Character, 5))).length).toBe(4);
    expect(drawn.filter((t) => t.equals(new HonorTile(Wind.East))).length).toBe(4);
    expect(drawn.filter((t) => t.equals(new HonorTile(Dragon.Red))).length).toBe(4);
    expect(drawn.filter((t) => t.equals(new BonusTile('flower', 1))).length).toBe(1);
  });
});
