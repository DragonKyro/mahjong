import { describe, it, expect } from 'vitest';
import { RemotePolicy } from './RemotePolicy';
import { SuitTile, Suit } from '@core/tiles/SuitTile';
import { Wind } from '@core/tiles/HonorTile';
import type { PlayerView } from '@core/game/types';

const emptyView: PlayerView = {
  self: { seatWind: Wind.East, hand: [], melds: [], bonuses: [], discards: [] },
  others: [],
  prevailingWind: Wind.East,
  dealer: Wind.East,
  wallRemaining: 0,
  lastDiscard: null,
};

describe('RemotePolicy', () => {
  it('resolves chooseAction when receiveAction is called', async () => {
    const p = new RemotePolicy();
    const tile = new SuitTile(Suit.Character, 3);
    const future = p.chooseAction(emptyView, null);
    p.receiveAction({ kind: 'discard', tile });
    const result = await future;
    expect(result.kind).toBe('discard');
    if (result.kind === 'discard') {
      expect(result.tile.equals(tile)).toBe(true);
    }
  });

  it('resolves chooseClaim when receiveClaim is called', async () => {
    const p = new RemotePolicy();
    const future = p.chooseClaim(emptyView, new SuitTile(Suit.Character, 3), Wind.South, [
      { kind: 'pass' },
      { kind: 'pong' },
    ]);
    p.receiveClaim({ kind: 'pong' });
    const result = await future;
    expect(result.kind).toBe('pong');
  });

  it('throws when a second chooseAction is requested before the first resolves', () => {
    const p = new RemotePolicy();
    void p.chooseAction(emptyView, null);
    expect(() => p.chooseAction(emptyView, null)).toThrow(/still pending/);
  });

  it('ignores receiveAction when nothing is pending', () => {
    const p = new RemotePolicy();
    // No throw, no crash
    expect(() => p.receiveAction({ kind: 'win' })).not.toThrow();
  });

  it('abort() rejects in-flight chooseAction', async () => {
    const p = new RemotePolicy();
    const future = p.chooseAction(emptyView, null);
    p.abort('peer disconnected');
    await expect(future).rejects.toThrow(/peer disconnected/);
  });

  it('abort() rejects in-flight chooseClaim', async () => {
    const p = new RemotePolicy();
    const future = p.chooseClaim(emptyView, new SuitTile(Suit.Character, 3), Wind.South, [
      { kind: 'pass' },
    ]);
    p.abort('host left');
    await expect(future).rejects.toThrow(/host left/);
  });
});
