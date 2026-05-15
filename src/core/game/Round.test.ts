import { describe, it, expect } from 'vitest';
import { Round } from './Round';
import { Wall, TOTAL_TILES, DEAD_WALL_SIZE } from '@core/tiles/Wall';
import { SuitTile, Suit } from '@core/tiles/SuitTile';
import { HonorTile, Wind } from '@core/tiles/HonorTile';
import { BonusTile } from '@core/tiles/BonusTile';
import { HumanPlayer } from '@core/players/HumanPlayer';
import { ScriptedPolicy } from '@core/players/ScriptedPolicy';
import type { PlayerPolicy } from '@core/players/PlayerPolicy';
import type { Tile } from '@core/tiles/Tile';
import type { SeatedPlayers } from './Round';
import { mulberry32 } from '@utils/rng';

// ---------- Test helpers ----------

/** A bland filler tile used to pad wall slots the test doesn't care about. */
const FILLER: Tile = new HonorTile(Wind.North);

/**
 * Build a fully-controlled wall. The 4×13 deal interleaves: hands[p][i] goes to
 * player p on the (i+1)th dealing pass. `draws[0]` is the first live-wall draw
 * after the deal. `replacements[0]` is the first dead-wall draw.
 */
function buildRiggedWall(opts: {
  hands: readonly [readonly Tile[], readonly Tile[], readonly Tile[], readonly Tile[]];
  draws?: readonly Tile[];
  replacements?: readonly Tile[];
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
  // Dead wall is read from the back, so reverse the replacements array.
  const dead: Tile[] = [];
  for (let i = 0; i < DEAD_WALL_SIZE; i++) {
    dead.push(opts.replacements?.[i] ?? FILLER);
  }
  for (let i = DEAD_WALL_SIZE - 1; i >= 0; i--) {
    tiles.push(dead[i]!);
  }
  return Wall.fromOrder(tiles);
}

function fourPlayers(policies?: readonly [PlayerPolicy, PlayerPolicy, PlayerPolicy, PlayerPolicy]): SeatedPlayers {
  const p = policies ?? [new ScriptedPolicy(), new ScriptedPolicy(), new ScriptedPolicy(), new ScriptedPolicy()];
  return [
    new HumanPlayer('East', Wind.East, p[0]),
    new HumanPlayer('South', Wind.South, p[1]),
    new HumanPlayer('West', Wind.West, p[2]),
    new HumanPlayer('North', Wind.North, p[3]),
  ];
}

/** Fills out a 13-tile hand to length 13 with FILLER. */
function pad(hand: readonly Tile[]): Tile[] {
  const out: Tile[] = [...hand];
  while (out.length < 13) out.push(FILLER);
  return out;
}

// ---------- Tests ----------

describe('Round.deal', () => {
  it('gives every player exactly 13 concealed tiles when no bonuses are dealt', async () => {
    const winOnFirstAction = new ScriptedPolicy({ chooseAction: () => ({ kind: 'win' }) });
    const players = fourPlayers([winOnFirstAction, new ScriptedPolicy(), new ScriptedPolicy(), new ScriptedPolicy()]);
    const wall = buildRiggedWall({
      hands: [pad([]), pad([]), pad([]), pad([])],
    });
    await new Round(players, wall, Wind.East, Wind.East).play();
    expect(players[1].hand.concealed.length).toBe(13);
    expect(players[2].hand.concealed.length).toBe(13);
    expect(players[3].hand.concealed.length).toBe(13);
    // East drew their 14th, declared win — hand should be 14.
    expect(players[0].hand.concealed.length).toBe(14);
  });

  it('replaces bonus tiles drawn during the deal with dead-wall tiles', async () => {
    // Slot East's first dealt tile with a bonus; verify the replacement goes
    // to bonus pile and a non-bonus fills the concealed slot.
    const eastHand = pad([new BonusTile('flower', 1)]);
    const wall = buildRiggedWall({
      hands: [eastHand, pad([]), pad([]), pad([])],
      replacements: [new SuitTile(Suit.Character, 7)],
    });
    const players = fourPlayers([
      new ScriptedPolicy({ chooseAction: () => ({ kind: 'win' }) }),
      new ScriptedPolicy(),
      new ScriptedPolicy(),
      new ScriptedPolicy(),
    ]);
    const round = new Round(players, wall, Wind.East, Wind.East);
    await round.play();
    expect(players[0].hand.bonuses.map((b) => b.toString())).toEqual(['F1']);
    expect(players[0].hand.concealed.some((t) => t.equals(new SuitTile(Suit.Character, 7)))).toBe(true);
  });
});

describe('Round turn loop — wins', () => {
  it('ends in self-draw win when active player chooses win on their draw', async () => {
    const players = fourPlayers([
      new ScriptedPolicy({ chooseAction: () => ({ kind: 'win' }) }),
      new ScriptedPolicy(),
      new ScriptedPolicy(),
      new ScriptedPolicy(),
    ]);
    const wall = new Wall(mulberry32(1));
    const outcome = await new Round(players, wall, Wind.East, Wind.East).play();
    expect(outcome.kind).toBe('win');
    if (outcome.kind === 'win') {
      expect(outcome.winner).toBe(Wind.East);
      expect(outcome.from).toBe(null);
    }
  });

  it('ends in discard win when another player claims the discard', async () => {
    // East discards 5m on their first turn (deterministic via rigged hand).
    // South claims win on that discard.
    const targetDiscard = new SuitTile(Suit.Character, 5);
    const wall = buildRiggedWall({
      hands: [pad([targetDiscard]), pad([]), pad([]), pad([])],
      draws: [new SuitTile(Suit.Character, 9)], // East's 14th-tile draw
    });
    const players = fourPlayers([
      // East discards 5m specifically (not the just-drawn 9m).
      new ScriptedPolicy({ chooseAction: () => ({ kind: 'discard', tile: targetDiscard }) }),
      // South wins on 5m discard.
      new ScriptedPolicy({
        chooseClaim: (_v, _d, _f, options) => options.find((o) => o.kind === 'pass') ? { kind: 'win' } : { kind: 'pass' },
      }),
      new ScriptedPolicy(),
      new ScriptedPolicy(),
    ]);
    const outcome = await new Round(players, wall, Wind.East, Wind.East).play();
    expect(outcome.kind).toBe('win');
    if (outcome.kind === 'win') {
      expect(outcome.winner).toBe(Wind.South);
      expect(outcome.from).toBe(Wind.East);
      expect(outcome.winningTile.equals(targetDiscard)).toBe(true);
    }
  });
});

describe('Round turn loop — claims', () => {
  it('transfers the turn to the claimer on a pong, exposes the meld, and skips the draw', async () => {
    const target = new SuitTile(Suit.Bamboo, 7);
    // East holds the 5m it will discard; West holds 2x 7s ready to pong it.
    const eastHand = pad([target]);
    const westHand = pad([target, target]);
    const wall = buildRiggedWall({
      hands: [eastHand, pad([]), westHand, pad([])],
      draws: [new SuitTile(Suit.Circle, 1)], // East's 14th draw
    });
    let westDiscardedCount = 0;
    const players = fourPlayers([
      new ScriptedPolicy({ chooseAction: () => ({ kind: 'discard', tile: target }) }),
      new ScriptedPolicy(),
      new ScriptedPolicy({
        chooseClaim: (_v, _d, _f, options) =>
          options.find((o) => o.kind === 'pong') ? { kind: 'pong' } : { kind: 'pass' },
        chooseAction: (view, drawn) => {
          westDiscardedCount++;
          // After pong, drawn should be null. Discard any concealed tile.
          expect(drawn).toBeNull();
          return { kind: 'discard', tile: view.self.hand[0]! };
        },
      }),
      // North ends the round after a few turns so we don't loop forever; use winner-on-action.
      new ScriptedPolicy({ chooseAction: () => ({ kind: 'win' }) }),
    ]);
    const round = new Round(players, wall, Wind.East, Wind.East);
    await round.play();
    // West should have an exposed pong of 7s.
    const pongMeld = players[2].hand.melds.find((m) => m.type === 'pong');
    expect(pongMeld?.tiles.every((t) => t.equals(target))).toBe(true);
    expect(pongMeld?.concealed).toBe(false);
    expect(pongMeld?.claimedFrom).toBe(Wind.East);
    expect(westDiscardedCount).toBeGreaterThan(0);
  });

  it('offers chi only to the player immediately after the discarder', async () => {
    const discard = new SuitTile(Suit.Bamboo, 5);
    // South (下家 of East) has 4s+6s → can chi.
    // West has 3s+4s → cannot chi (not 下家).
    const eastHand = pad([discard]);
    const southHand = pad([new SuitTile(Suit.Bamboo, 4), new SuitTile(Suit.Bamboo, 6)]);
    const westHand = pad([new SuitTile(Suit.Bamboo, 3), new SuitTile(Suit.Bamboo, 4)]);
    const wall = buildRiggedWall({
      hands: [eastHand, southHand, westHand, pad([])],
      draws: [new SuitTile(Suit.Circle, 1)],
    });

    const offeredToSouth: string[] = [];
    const offeredToWest: string[] = [];
    const players = fourPlayers([
      new ScriptedPolicy({ chooseAction: () => ({ kind: 'discard', tile: discard }) }),
      new ScriptedPolicy({
        chooseClaim: (_v, _d, _f, options) => {
          for (const o of options) offeredToSouth.push(o.kind);
          return { kind: 'pass' };
        },
      }),
      new ScriptedPolicy({
        chooseClaim: (_v, _d, _f, options) => {
          for (const o of options) offeredToWest.push(o.kind);
          return { kind: 'pass' };
        },
      }),
      // End fast.
      new ScriptedPolicy({ chooseAction: () => ({ kind: 'win' }) }),
    ]);
    await new Round(players, wall, Wind.East, Wind.East).play();
    expect(offeredToSouth).toContain('chi');
    expect(offeredToWest).not.toContain('chi');
  });

  it('handles exposed kong from a discard: draws a replacement, then the claimer acts', async () => {
    const target = new SuitTile(Suit.Character, 3);
    const replacement = new SuitTile(Suit.Circle, 4);
    const eastHand = pad([target]);
    const westHand = pad([target, target, target]); // 3 of target in hand → can kong
    const wall = buildRiggedWall({
      hands: [eastHand, pad([]), westHand, pad([])],
      draws: [new SuitTile(Suit.Circle, 1)],
      replacements: [replacement],
    });

    const captured: { drawn: Tile | null } = { drawn: null };
    const players = fourPlayers([
      new ScriptedPolicy({ chooseAction: () => ({ kind: 'discard', tile: target }) }),
      new ScriptedPolicy(),
      new ScriptedPolicy({
        chooseClaim: (_v, _d, _f, options) =>
          options.find((o) => o.kind === 'kong') ? { kind: 'kong' } : { kind: 'pass' },
        chooseAction: (view, drawn) => {
          captured.drawn = drawn;
          return { kind: 'discard', tile: view.self.hand[0]! };
        },
      }),
      new ScriptedPolicy({ chooseAction: () => ({ kind: 'win' }) }),
    ]);
    await new Round(players, wall, Wind.East, Wind.East).play();

    const kongMeld = players[2].hand.melds.find((m) => m.type === 'kong');
    expect(kongMeld).toBeDefined();
    expect(kongMeld?.tiles.length).toBe(4);
    expect(captured.drawn?.equals(replacement)).toBe(true);
  });

  it('handles concealed kong (self-kong) declared by the active player', async () => {
    const target = new SuitTile(Suit.Character, 3);
    const replacement = new SuitTile(Suit.Circle, 8);
    // East starts with all 4 of the target in their dealt 13 — possible because hand size is 13.
    const eastHand = pad([target, target, target, target]);
    const wall = buildRiggedWall({
      hands: [eastHand, pad([]), pad([]), pad([])],
      draws: [new SuitTile(Suit.Bamboo, 2)], // East's 14th
      replacements: [replacement],
    });

    let calls = 0;
    const captured: { drawn: Tile | null } = { drawn: null };
    const players = fourPlayers([
      new ScriptedPolicy({
        chooseAction: (view, drawn) => {
          calls++;
          if (calls === 1) return { kind: 'self-kong', tile: target };
          // After the kong, engine re-enters chooseAction with the replacement.
          captured.drawn = drawn;
          return { kind: 'discard', tile: view.self.hand[0]! };
        },
      }),
      new ScriptedPolicy(),
      new ScriptedPolicy(),
      new ScriptedPolicy({ chooseAction: () => ({ kind: 'win' }) }),
    ]);
    await new Round(players, wall, Wind.East, Wind.East).play();

    const kongMeld = players[0].hand.melds.find((m) => m.type === 'kong');
    expect(kongMeld).toBeDefined();
    expect(kongMeld?.concealed).toBe(true);
    expect(captured.drawn?.equals(replacement)).toBe(true);
  });
});

describe('Round end conditions', () => {
  it('returns a draw outcome when the live wall is exhausted with no claims/wins', async () => {
    // Default policies discard the just-drawn tile, never claim → no one wins.
    const players = fourPlayers();
    const wall = new Wall(mulberry32(123));
    const outcome = await new Round(players, wall, Wind.East, Wind.East).play();
    expect(outcome.kind).toBe('draw');
    // Live wall is fully drained.
    expect(wall.liveRemaining()).toBe(0);
  });
});
