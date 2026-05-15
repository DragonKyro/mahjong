import { Meld, type MeldOptions } from './Meld';
import type { Tile } from '@core/tiles/Tile';

export type PongTiles = readonly [Tile, Tile, Tile];

/**
 * A triplet (pong / 碰): three identical tiles. Bonus tiles cannot form a pong.
 */
export class Pong extends Meld {
  readonly type = 'pong' as const;
  readonly tiles: PongTiles;

  constructor(tiles: PongTiles, opts: MeldOptions) {
    super(opts);
    if (tiles[0].isBonus()) {
      throw new Error('Cannot form a pong from bonus tiles');
    }
    if (!tiles[0].equals(tiles[1]) || !tiles[1].equals(tiles[2])) {
      throw new Error(`Pong tiles must all be equal, got ${tiles.map((t) => t.toString()).join(',')}`);
    }
    this.tiles = tiles;
  }
}
