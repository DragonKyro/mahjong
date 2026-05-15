import { describe, it, expect } from 'vitest';
import { Round } from './Round';
import { Wall, TOTAL_TILES, DEAD_WALL_SIZE } from '@core/tiles/Wall';
import { SuitTile, Suit } from '@core/tiles/SuitTile';
import { HonorTile, Wind, Dragon } from '@core/tiles/HonorTile';
import { HumanPlayer } from '@core/players/HumanPlayer';
import { ScriptedPolicy } from '@core/players/ScriptedPolicy';
import { HKOldStyleWinValidator } from '@core/scoring/HKOldStyleWinValidator';
import { FaanCalculator } from '@core/scoring/FaanCalculator';
import { DEFAULT_RULES } from '@core/scoring/RulesConfig';
import type { Tile } from '@core/tiles/Tile';
import type { SeatedPlayers } from './Round';
import type { PlayerPolicy } from '@core/players/PlayerPolicy';

// Rigged-wall helper (mirrors the one in Round.test.ts).
const FILLER: Tile = new HonorTile(Wind.North);

function buildRiggedWall(opts: {
  hands: readonly [readonly Tile[], readonly Tile[], readonly Tile[], readonly Tile[]];
  draws?: readonly Tile[];
}): Wall {
  const tiles: Tile[] = [];
  for (let i = 0; i < 13; i++) {
    for (let p = 0; p < 4; p++) {
      tiles.push(opts.hands[p]![i] ?? FILLER);
    }
  }
  const liveBudget = TOTAL_TILES - DEAD_WALL_SIZE - tiles.length;
  for (let i = 0; i < liveBudget; i++) {
    tiles.push(opts.draws?.[i] ?? FILLER);
  }
  for (let i = 0; i < DEAD_WALL_SIZE; i++) tiles.push(FILLER);
  return Wall.fromOrder(tiles);
}

function pad(hand: readonly Tile[]): Tile[] {
  const out: Tile[] = [...hand];
  while (out.length < 13) out.push(FILLER);
  return out;
}

function seat(p: readonly [PlayerPolicy, PlayerPolicy, PlayerPolicy, PlayerPolicy]): SeatedPlayers {
  return [
    new HumanPlayer('East', Wind.East, p[0]),
    new HumanPlayer('South', Wind.South, p[1]),
    new HumanPlayer('West', Wind.West, p[2]),
    new HumanPlayer('North', Wind.North, p[3]),
  ];
}

const m = (r: number) => new SuitTile(Suit.Character, r as 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9);
const p = (r: number) => new SuitTile(Suit.Circle, r as 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9);
const s = (r: number) => new SuitTile(Suit.Bamboo, r as 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9);
const E = () => new HonorTile(Wind.East);
const Red = () => new HonorTile(Dragon.Red);

describe('Round + strict HKOldStyleWinValidator', () => {
  it('accepts a self-draw win that exceeds the 3-faan minimum (對對和 + dragon pong + self-draw)', () => {
    // East dealt: 2m×3, 5p×3, 7s×3, 中×2, 東×2 (13 tiles).
    // First draw: 中. Hand becomes 2m×3 5p×3 7s×3 中×3 + 東×2 → 4 pongs + 1 pair = 對對和.
    // Faan: 對對和 (3) + dragon pong (1) + 自摸 (1) = 5, ≥ 3 minimum.
    const eastHand: Tile[] = [
      m(2), m(2), m(2),
      p(5), p(5), p(5),
      s(7), s(7), s(7),
      Red(), Red(),
      E(), E(),
    ];
    const wall = buildRiggedWall({
      hands: [eastHand, pad([]), pad([]), pad([])],
      draws: [Red()],
    });
    const players = seat([
      new ScriptedPolicy({ chooseAction: () => ({ kind: 'win' }) }),
      new ScriptedPolicy(),
      new ScriptedPolicy(),
      new ScriptedPolicy(),
    ]);
    const round = new Round(players, wall, Wind.East, Wind.East, {
      winValidator: new HKOldStyleWinValidator(DEFAULT_RULES),
      faanCalculator: new FaanCalculator(DEFAULT_RULES),
    });
    const outcome = round.play();
    expect(outcome.kind).toBe('win');
    if (outcome.kind === 'win') {
      expect(outcome.faan).toBeDefined();
      expect(outcome.faan!.total).toBeGreaterThanOrEqual(DEFAULT_RULES.minFaan);
      const ids = outcome.faan!.entries.map((e) => e.id);
      expect(ids).toContain('all-triplets');
      expect(ids).toContain('self-draw');
    }
  });

  it('rejects a self-draw win that scores below the 3-faan minimum (雞胡 hand)', () => {
    // 2 chi + 2 simple pongs + simple pair = 0 shape faan; with self-draw (1) +
    // 門前清 (1) = 2 faan total, below the 3-faan minimum.
    const eastHand: Tile[] = [
      m(1), m(2), m(3),
      p(4), p(5), p(6),
      s(7), s(7), s(7),
      m(8), m(8),
      p(2), p(2),
    ];
    const wall = buildRiggedWall({
      hands: [eastHand, pad([]), pad([]), pad([])],
      draws: [m(8)], // completes the m(8) pong
    });
    const players = seat([
      new ScriptedPolicy({ chooseAction: () => ({ kind: 'win' }) }),
      new ScriptedPolicy(),
      new ScriptedPolicy(),
      new ScriptedPolicy(),
    ]);
    const round = new Round(players, wall, Wind.East, Wind.East, {
      winValidator: new HKOldStyleWinValidator(DEFAULT_RULES),
      faanCalculator: new FaanCalculator(DEFAULT_RULES),
    });
    expect(() => round.play()).toThrow(/validator rejected/);
  });

  it('does not offer the win claim option to a seat whose hand cannot win on the discard', () => {
    // East discards 5m. South holds 13 fillers that don't pair-up or chi with 5m,
    // so the validator should suppress `win` from South's options for this discard.
    const offeredOnM5: string[] = [];
    const eastHand: Tile[] = [m(5), ...pad([]).slice(0, 12)];
    const wall = buildRiggedWall({
      hands: [eastHand, pad([]), pad([]), pad([])],
      draws: [m(7)],
    });
    const players = seat([
      new ScriptedPolicy({ chooseAction: () => ({ kind: 'discard', tile: m(5) }) }),
      new ScriptedPolicy({
        chooseClaim: (_v, discard, _f, options) => {
          if (discard.toString() === '5m') {
            for (const o of options) offeredOnM5.push(o.kind);
          }
          return { kind: 'pass' };
        },
      }),
      new ScriptedPolicy(),
      new ScriptedPolicy(),
    ]);
    const round = new Round(players, wall, Wind.East, Wind.East, {
      winValidator: new HKOldStyleWinValidator(DEFAULT_RULES),
      faanCalculator: new FaanCalculator(DEFAULT_RULES),
    });
    try {
      round.play();
    } catch {
      // Round may throw later on a downstream invalid claim — we only care
      // about what was offered to South on the specific m(5) discard.
    }
    // South may legitimately not be polled at all on m(5) (only `pass` available)
    // — in that case the array is empty, which is also fine.
    expect(offeredOnM5).not.toContain('win');
  });
});
