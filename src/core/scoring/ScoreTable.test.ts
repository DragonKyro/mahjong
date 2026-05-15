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

describe('ScoreTable.scoreWin (HK Old Style with dealer doubling)', () => {
  const table = new ScoreTable(DEFAULT_RULES);

  it('self-draw, non-dealer winner: each loser pays V, dealer pays 2V', () => {
    // V = 1u at 3 faan. Winner = South. Dealer = East.
    const d = table.scoreWin({
      faan: 3,
      winnerSeat: Wind.South,
      fromSeat: null,
      dealer: Wind.East,
    });
    expect(d.get(Wind.East)).toBe(-2); // dealer doubled
    expect(d.get(Wind.West)).toBe(-1);
    expect(d.get(Wind.North)).toBe(-1);
    expect(d.get(Wind.South)).toBe(4); // 2 + 1 + 1
  });

  it('self-draw, dealer winner: every loser pays 2V', () => {
    // V = 1u. Dealer self-draw doubles every payment.
    const d = table.scoreWin({
      faan: 3,
      winnerSeat: Wind.East,
      fromSeat: null,
      dealer: Wind.East,
    });
    expect(d.get(Wind.South)).toBe(-2);
    expect(d.get(Wind.West)).toBe(-2);
    expect(d.get(Wind.North)).toBe(-2);
    expect(d.get(Wind.East)).toBe(6);
  });

  it('discard win, no dealer involved: discarder 2V, others V', () => {
    // Dealer = North, winner = South, discarder = West.
    // None of the three losers is the dealer except North (a non-discarder loser).
    // Wait — that means North IS dealer. Let's choose dealer = a player not in this hand context.
    // Use dealer = winner-seat? No, winner can't be paid by themselves. Use a dealer that's
    // neither winner nor discarder nor in the "other two losers" — but every player is
    // exactly one of those four. So "no dealer involved" actually means dealer is the winner
    // OR the test setup makes dealer irrelevant. The truly "no doubling" case is when the
    // dealer is the winner (we covered above) or dealerDoubling is off (we cover below).
    //
    // For a discard win where the dealer doesn't get doubled, we need the dealer to be the
    // winner — but then winner-doubling kicks in. So a "no dealer involved" case requires
    // dealerDoubling off. We test that variant below.
    //
    // Here, we'll verify the standard 2V/V split with dealer-double applied to whichever
    // loser is dealer. Choose: dealer = third loser (North).
    const d = table.scoreWin({
      faan: 3,
      winnerSeat: Wind.South,
      fromSeat: Wind.West,
      dealer: Wind.North,
    });
    expect(d.get(Wind.West)).toBe(-2); // discarder pays 2V (not dealer)
    expect(d.get(Wind.North)).toBe(-2); // third loser, dealer-doubled to 2V
    expect(d.get(Wind.East)).toBe(-1); // third loser, no doubling
    expect(d.get(Wind.South)).toBe(5); // 2 + 2 + 1
  });

  it('discard win, dealer is the winner: discarder 4V, other losers 2V', () => {
    const d = table.scoreWin({
      faan: 3,
      winnerSeat: Wind.East,
      fromSeat: Wind.South,
      dealer: Wind.East,
    });
    expect(d.get(Wind.South)).toBe(-4); // discarder 2V × 2 (winner=dealer)
    expect(d.get(Wind.West)).toBe(-2); // other loser V × 2
    expect(d.get(Wind.North)).toBe(-2);
    expect(d.get(Wind.East)).toBe(8); // 4 + 2 + 2
  });

  it('discard win, dealer is the discarder (winner non-dealer): discarder 4V, others V', () => {
    const d = table.scoreWin({
      faan: 3,
      winnerSeat: Wind.South,
      fromSeat: Wind.East,
      dealer: Wind.East,
    });
    expect(d.get(Wind.East)).toBe(-4); // 2V × 2 (loser=dealer)
    expect(d.get(Wind.West)).toBe(-1);
    expect(d.get(Wind.North)).toBe(-1);
    expect(d.get(Wind.South)).toBe(6); // 4 + 1 + 1
  });

  it('higher faan scales V correctly under doubling', () => {
    // 5 faan = 4u. Dealer self-draw → each loser pays 8.
    const d = table.scoreWin({
      faan: 5,
      winnerSeat: Wind.East,
      fromSeat: null,
      dealer: Wind.East,
    });
    expect(d.get(Wind.South)).toBe(-8);
    expect(d.get(Wind.West)).toBe(-8);
    expect(d.get(Wind.North)).toBe(-8);
    expect(d.get(Wind.East)).toBe(24);
  });

  it('limit-faan cap applies before doubling', () => {
    // 50 faan caps at 13 → V = 1024u. Non-dealer discard win, dealer is third loser.
    const d = table.scoreWin({
      faan: 50,
      winnerSeat: Wind.South,
      fromSeat: Wind.West,
      dealer: Wind.North,
    });
    expect(d.get(Wind.West)).toBe(-2 * 1024); // discarder 2V
    expect(d.get(Wind.North)).toBe(-2 * 1024); // dealer-doubled V
    expect(d.get(Wind.East)).toBe(-1024);
    expect(d.get(Wind.South)).toBe(5 * 1024);
  });
});

describe('ScoreTable.scoreWin (dealerDoubling disabled)', () => {
  const table = new ScoreTable({ ...DEFAULT_RULES, dealerDoubling: false });

  it('self-draw: every loser pays V regardless of dealer', () => {
    const d = table.scoreWin({
      faan: 3,
      winnerSeat: Wind.East,
      fromSeat: null,
      dealer: Wind.East,
    });
    expect(d.get(Wind.South)).toBe(-1);
    expect(d.get(Wind.West)).toBe(-1);
    expect(d.get(Wind.North)).toBe(-1);
    expect(d.get(Wind.East)).toBe(3);
  });

  it('discard: discarder pays 2V, others V — no dealer multiplier', () => {
    const d = table.scoreWin({
      faan: 3,
      winnerSeat: Wind.South,
      fromSeat: Wind.East,
      dealer: Wind.East,
    });
    expect(d.get(Wind.East)).toBe(-2); // discarder
    expect(d.get(Wind.West)).toBe(-1);
    expect(d.get(Wind.North)).toBe(-1);
    expect(d.get(Wind.South)).toBe(4);
  });
});
