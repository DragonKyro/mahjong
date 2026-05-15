import { Meld, type MeldOptions } from './Meld';
import type { Tile } from '@core/tiles/Tile';
import type { Wind } from '@core/tiles/HonorTile';

export type KongTiles = readonly [Tile, Tile, Tile, Tile];

/**
 * Kong (quad) variants:
 * - `concealed` (暗槓): all four tiles drawn into hand, declared by the holder.
 * - `exposed`   (明槓): claimed a discard while holding three of the tile.
 * - `added`     (加槓): had a pong, drew the fourth, and promoted the meld.
 */
export type KongKind = 'concealed' | 'exposed' | 'added';

export class Kong extends Meld {
  readonly type = 'kong' as const;
  readonly tiles: KongTiles;
  readonly kongKind: KongKind;

  constructor(tiles: KongTiles, kongKind: KongKind, claimedFrom?: Wind) {
    const opts: MeldOptions = {
      concealed: kongKind === 'concealed',
      claimedFrom,
    };
    super(opts);
    if (tiles[0].isBonus()) {
      throw new Error('Cannot form a kong from bonus tiles');
    }
    if (!tiles[0].equals(tiles[1]) || !tiles[1].equals(tiles[2]) || !tiles[2].equals(tiles[3])) {
      throw new Error(
        `Kong tiles must all be equal, got ${tiles.map((t) => t.toString()).join(',')}`,
      );
    }
    if (kongKind !== 'concealed' && claimedFrom === undefined) {
      throw new Error(`Non-concealed kong (${kongKind}) requires a claimedFrom seat`);
    }
    this.tiles = tiles;
    this.kongKind = kongKind;
  }
}
