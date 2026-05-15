import { describe, it, expect } from 'vitest';
import {
  tileToWire,
  wireToTile,
  actionToWire,
  wireToAction,
  claimToWire,
  wireToClaim,
  windToSeat,
  seatToWind,
} from './Protocol';
import { SuitTile, Suit } from '@core/tiles/SuitTile';
import { HonorTile, Wind, Dragon } from '@core/tiles/HonorTile';
import { BonusTile } from '@core/tiles/BonusTile';

describe('Tile wire (de)serialization', () => {
  it('round-trips every suit tile', () => {
    for (const suit of [Suit.Character, Suit.Circle, Suit.Bamboo]) {
      for (let r = 1; r <= 9; r++) {
        const t = new SuitTile(suit, r as 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9);
        const w = tileToWire(t);
        const back = wireToTile(w);
        expect(back.equals(t)).toBe(true);
      }
    }
  });

  it('round-trips every honor tile', () => {
    for (const honor of [
      Wind.East,
      Wind.South,
      Wind.West,
      Wind.North,
      Dragon.Red,
      Dragon.Green,
      Dragon.White,
    ]) {
      const t = new HonorTile(honor);
      expect(wireToTile(tileToWire(t)).equals(t)).toBe(true);
    }
  });

  it('round-trips every bonus tile', () => {
    for (const cat of ['flower', 'season'] as const) {
      for (let i = 1; i <= 4; i++) {
        const t = new BonusTile(cat, i as 1 | 2 | 3 | 4);
        expect(wireToTile(tileToWire(t)).equals(t)).toBe(true);
      }
    }
  });

  it('throws on garbage input', () => {
    expect(() => wireToTile('')).toThrow();
    expect(() => wireToTile('xyz')).toThrow();
    expect(() => wireToTile('10m')).toThrow();
  });
});

describe('Action / Claim wire (de)serialization', () => {
  it('round-trips every action variant', () => {
    const tile = new SuitTile(Suit.Character, 3);
    const wins = wireToAction(actionToWire({ kind: 'win' }));
    expect(wins.kind).toBe('win');
    const discard = wireToAction(actionToWire({ kind: 'discard', tile }));
    expect(discard.kind).toBe('discard');
    if (discard.kind === 'discard') expect(discard.tile.equals(tile)).toBe(true);
    const sk = wireToAction(actionToWire({ kind: 'self-kong', tile }));
    expect(sk.kind).toBe('self-kong');
    const ak = wireToAction(actionToWire({ kind: 'add-kong', tile }));
    expect(ak.kind).toBe('add-kong');
  });

  it('round-trips every claim variant including chi helpers', () => {
    expect(wireToClaim(claimToWire({ kind: 'pass' })).kind).toBe('pass');
    expect(wireToClaim(claimToWire({ kind: 'pong' })).kind).toBe('pong');
    expect(wireToClaim(claimToWire({ kind: 'kong' })).kind).toBe('kong');
    expect(wireToClaim(claimToWire({ kind: 'win' })).kind).toBe('win');
    const chi = wireToClaim(
      claimToWire({
        kind: 'chi',
        helpers: [new SuitTile(Suit.Bamboo, 3), new SuitTile(Suit.Bamboo, 4)],
      }),
    );
    expect(chi.kind).toBe('chi');
    if (chi.kind === 'chi') {
      expect(chi.helpers[0].toString()).toBe('3s');
      expect(chi.helpers[1].toString()).toBe('4s');
    }
  });
});

describe('Wind <-> SeatName', () => {
  it('round-trips all four winds', () => {
    for (const w of [Wind.East, Wind.South, Wind.West, Wind.North]) {
      expect(seatToWind(windToSeat(w))).toBe(w);
    }
  });
});
