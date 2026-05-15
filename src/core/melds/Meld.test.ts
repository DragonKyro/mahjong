import { describe, it, expect } from 'vitest';
import { Chi } from './Chi';
import { Pong } from './Pong';
import { Kong } from './Kong';
import { Pair } from './Pair';
import { SuitTile, Suit } from '@core/tiles/SuitTile';
import { HonorTile, Wind, Dragon } from '@core/tiles/HonorTile';
import { BonusTile } from '@core/tiles/BonusTile';

describe('Chi', () => {
  it('accepts three consecutive tiles in one suit', () => {
    const chi = new Chi(
      [new SuitTile(Suit.Character, 5), new SuitTile(Suit.Character, 3), new SuitTile(Suit.Character, 4)],
      { concealed: false, claimedFrom: Wind.East },
    );
    expect(chi.toString()).toBe('3m-4m-5m');
    expect(chi.type).toBe('chi');
    expect(chi.concealed).toBe(false);
    expect(chi.claimedFrom).toBe(Wind.East);
  });

  it('rejects mixed suits', () => {
    expect(
      () =>
        new Chi(
          [
            new SuitTile(Suit.Character, 3),
            new SuitTile(Suit.Circle, 4),
            new SuitTile(Suit.Character, 5),
          ],
          { concealed: false, claimedFrom: Wind.East },
        ),
    ).toThrow(/share a suit/);
  });

  it('rejects non-consecutive ranks', () => {
    expect(
      () =>
        new Chi(
          [
            new SuitTile(Suit.Character, 3),
            new SuitTile(Suit.Character, 5),
            new SuitTile(Suit.Character, 6),
          ],
          { concealed: false, claimedFrom: Wind.East },
        ),
    ).toThrow(/consecutive/);
  });
});

describe('Pong', () => {
  it('accepts three equal tiles', () => {
    const t = new HonorTile(Dragon.Red);
    const pong = new Pong(
      [new HonorTile(Dragon.Red), new HonorTile(Dragon.Red), new HonorTile(Dragon.Red)],
      { concealed: true },
    );
    expect(pong.tiles).toHaveLength(3);
    expect(pong.contains(t)).toBe(true);
  });

  it('rejects unequal tiles', () => {
    expect(
      () =>
        new Pong(
          [
            new SuitTile(Suit.Character, 3),
            new SuitTile(Suit.Character, 3),
            new SuitTile(Suit.Character, 4),
          ],
          { concealed: true },
        ),
    ).toThrow(/equal/);
  });

  it('rejects bonus tiles', () => {
    expect(
      () =>
        new Pong(
          [new BonusTile('flower', 1), new BonusTile('flower', 1), new BonusTile('flower', 1)],
          { concealed: true },
        ),
    ).toThrow(/bonus/);
  });
});

describe('Kong', () => {
  it('builds a concealed kong without a claimedFrom seat', () => {
    const tile = new HonorTile(Wind.East);
    const kong = new Kong(
      [
        new HonorTile(Wind.East),
        new HonorTile(Wind.East),
        new HonorTile(Wind.East),
        new HonorTile(Wind.East),
      ],
      'concealed',
    );
    expect(kong.kongKind).toBe('concealed');
    expect(kong.concealed).toBe(true);
    expect(kong.claimedFrom).toBeUndefined();
    expect(kong.contains(tile)).toBe(true);
  });

  it('exposed and added kongs require claimedFrom', () => {
    const four = [
      new SuitTile(Suit.Bamboo, 7),
      new SuitTile(Suit.Bamboo, 7),
      new SuitTile(Suit.Bamboo, 7),
      new SuitTile(Suit.Bamboo, 7),
    ] as const;
    expect(() => new Kong(four, 'exposed')).toThrow(/claimedFrom/);
    expect(() => new Kong(four, 'added')).toThrow(/claimedFrom/);
    const exposed = new Kong(four, 'exposed', Wind.South);
    expect(exposed.concealed).toBe(false);
    expect(exposed.claimedFrom).toBe(Wind.South);
  });

  it('rejects unequal tiles', () => {
    expect(
      () =>
        new Kong(
          [
            new SuitTile(Suit.Bamboo, 7),
            new SuitTile(Suit.Bamboo, 7),
            new SuitTile(Suit.Bamboo, 8),
            new SuitTile(Suit.Bamboo, 7),
          ],
          'concealed',
        ),
    ).toThrow(/equal/);
  });
});

describe('Pair', () => {
  it('accepts two equal tiles, concealed by default', () => {
    const p = new Pair([new HonorTile(Dragon.Green), new HonorTile(Dragon.Green)]);
    expect(p.type).toBe('pair');
    expect(p.concealed).toBe(true);
    expect(p.tiles).toHaveLength(2);
  });

  it('rejects unequal tiles', () => {
    expect(
      () => new Pair([new HonorTile(Dragon.Green), new HonorTile(Dragon.Red)]),
    ).toThrow(/equal/);
  });
});
