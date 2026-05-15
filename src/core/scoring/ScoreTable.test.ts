import { describe, it, expect } from 'vitest';
import { ScoreTable } from './ScoreTable';
import { DEFAULT_RULES } from './RulesConfig';
import { Wind } from '@core/tiles/HonorTile';

describe('ScoreTable.unitFor', () => {
  const table = new ScoreTable(DEFAULT_RULES);

  it('returns 1 unit at the min-faan threshold', () => {
    expect(table.unitFor(3)).toBe(1);
  });

  it('doubles every additional faan', () => {
    expect(table.unitFor(4)).toBe(2);
    expect(table.unitFor(5)).toBe(4);
    expect(table.unitFor(6)).toBe(8);
    expect(table.unitFor(7)).toBe(16);
  });

  it('caps at the limit faan threshold', () => {
    expect(table.unitFor(13)).toBe(2 ** 10);
    expect(table.unitFor(100)).toBe(2 ** 10);
  });

  it('clamps faan below the minimum to the minimum unit', () => {
    expect(table.unitFor(0)).toBe(1);
    expect(table.unitFor(2)).toBe(1);
  });
});

describe('ScoreTable.scoreWin', () => {
  const table = new ScoreTable(DEFAULT_RULES);

  it('discard win: only the discarder pays the winner', () => {
    const deltas = table.scoreWin({ faan: 3, winnerSeat: Wind.East, fromSeat: Wind.South });
    expect(deltas.get(Wind.East)).toBe(1);
    expect(deltas.get(Wind.South)).toBe(-1);
    expect(deltas.get(Wind.West)).toBe(0);
    expect(deltas.get(Wind.North)).toBe(0);
  });

  it('self-draw: each of the three other seats pays the winner', () => {
    const deltas = table.scoreWin({ faan: 4, winnerSeat: Wind.East, fromSeat: null });
    expect(deltas.get(Wind.East)).toBe(6); // 3 × 2 units
    expect(deltas.get(Wind.South)).toBe(-2);
    expect(deltas.get(Wind.West)).toBe(-2);
    expect(deltas.get(Wind.North)).toBe(-2);
  });

  it('limit hands pay the capped amount', () => {
    const deltas = table.scoreWin({ faan: 50, winnerSeat: Wind.West, fromSeat: Wind.East });
    expect(deltas.get(Wind.West)).toBe(2 ** 10);
    expect(deltas.get(Wind.East)).toBe(-(2 ** 10));
  });
});
