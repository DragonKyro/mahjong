import { Meld, type MeldOptions } from './Meld';
import type { Tile } from '@core/tiles/Tile';

export type PairTiles = readonly [Tile, Tile];

/**
 * The eyes/pair (雀頭 / 眼) of a winning hand. Conceptually always concealed —
 * pairs are never claimed from a discard. Lives in the Meld hierarchy so the
 * scoring code can iterate a hand's groupings uniformly.
 */
export class Pair extends Meld {
  readonly type = 'pair' as const;
  readonly tiles: PairTiles;

  constructor(tiles: PairTiles, opts?: Partial<MeldOptions>) {
    super({ concealed: opts?.concealed ?? true, claimedFrom: opts?.claimedFrom });
    if (tiles[0].isBonus()) {
      throw new Error('Cannot form a pair from bonus tiles');
    }
    if (!tiles[0].equals(tiles[1])) {
      throw new Error(`Pair tiles must be equal, got ${tiles.map((t) => t.toString()).join(',')}`);
    }
    this.tiles = tiles;
  }
}
