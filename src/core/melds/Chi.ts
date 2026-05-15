import { Meld, type MeldOptions } from './Meld';
import type { SuitTile } from '@core/tiles/SuitTile';

export type ChiTiles = readonly [SuitTile, SuitTile, SuitTile];

/**
 * A sequence (chi / 上 / 吃): three suit tiles of the same suit with consecutive ranks.
 * In Cantonese rules a chi may only be claimed from the player on the left (上家).
 */
export class Chi extends Meld {
  readonly type = 'chi' as const;
  readonly tiles: ChiTiles;

  constructor(tiles: ChiTiles, opts: MeldOptions) {
    super(opts);
    const sorted = [...tiles].sort((a, b) => a.compareTo(b)) as [SuitTile, SuitTile, SuitTile];
    if (sorted[0].suit !== sorted[1].suit || sorted[1].suit !== sorted[2].suit) {
      throw new Error(
        `Chi tiles must share a suit, got ${tiles.map((t) => t.toString()).join(',')}`,
      );
    }
    if (sorted[1].rank !== sorted[0].rank + 1 || sorted[2].rank !== sorted[1].rank + 1) {
      throw new Error(
        `Chi tiles must be three consecutive ranks, got ${tiles.map((t) => t.toString()).join(',')}`,
      );
    }
    this.tiles = sorted;
  }
}
