import { describe, it, expect } from 'vitest';
import { Game } from './Game';
import { Wind } from '@core/tiles/HonorTile';
import { HumanPlayer } from '@core/players/HumanPlayer';
import { ScriptedPolicy } from '@core/players/ScriptedPolicy';
import { mulberry32 } from '@utils/rng';
import { PermissiveWinValidator } from '@core/scoring/PermissiveWinValidator';
import type { SeatedPlayers } from './Round';
import type { PlayerPolicy } from '@core/players/PlayerPolicy';

const passivePolicy: PlayerPolicy = new ScriptedPolicy();
const insta: PlayerPolicy = new ScriptedPolicy({ chooseAction: () => ({ kind: 'win' }) });
const permissive = (): { winValidator: PermissiveWinValidator } => ({
  winValidator: new PermissiveWinValidator(),
});

function seat(policies: readonly [PlayerPolicy, PlayerPolicy, PlayerPolicy, PlayerPolicy]): SeatedPlayers {
  return [
    new HumanPlayer('East', Wind.East, policies[0]),
    new HumanPlayer('South', Wind.South, policies[1]),
    new HumanPlayer('West', Wind.West, policies[2]),
    new HumanPlayer('North', Wind.North, policies[3]),
  ];
}

describe('Game dealer rotation', () => {
  it('starts in East-round with East as dealer', () => {
    const g = new Game(seat([passivePolicy, passivePolicy, passivePolicy, passivePolicy]));
    expect(g.prevailingWind).toBe(Wind.East);
    expect(g.dealer).toBe(Wind.East);
  });

  it('retains the dealer (連莊) when the dealer wins the round', async () => {
    const g = new Game(seat([insta, passivePolicy, passivePolicy, passivePolicy]), permissive());
    const outcome = await g.playRound(mulberry32(1));
    expect(outcome.kind).toBe('win');
    expect(g.dealer).toBe(Wind.East);
    expect(g.prevailingWind).toBe(Wind.East);
  });

  it('rotates dealer East → South when a non-dealer wins', async () => {
    const g = new Game(seat([passivePolicy, insta, passivePolicy, passivePolicy]), permissive());
    const outcome = await g.playRound(mulberry32(1));
    expect(outcome.kind).toBe('win');
    expect(g.dealer).toBe(Wind.South);
    expect(g.prevailingWind).toBe(Wind.East);
  });

  it('rotates dealer on a draw outcome (wall exhaust)', async () => {
    const g = new Game(seat([passivePolicy, passivePolicy, passivePolicy, passivePolicy]), permissive());
    const outcome = await g.playRound(mulberry32(7));
    expect(outcome.kind).toBe('draw');
    expect(g.dealer).toBe(Wind.South);
  });

  it('advances the prevailing wind when the dealer cycles back to East', async () => {
    const g = new Game(seat([insta, passivePolicy, passivePolicy, passivePolicy]), {
      ...permissive(),
      dealer: Wind.North,
    });
    await g.playRound(mulberry32(1));
    expect(g.dealer).toBe(Wind.East);
    expect(g.prevailingWind).toBe(Wind.South);
  });

  it('records each round outcome in history', async () => {
    const g = new Game(seat([passivePolicy, insta, passivePolicy, passivePolicy]), permissive());
    await g.playRound(mulberry32(1));
    await g.playRound(mulberry32(2));
    expect(g.history.length).toBe(2);
  });
});
