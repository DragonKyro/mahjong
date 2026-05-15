import type { Tile } from '@core/tiles/Tile';
import type { Wind } from '@core/tiles/HonorTile';

export type MeldType = 'chi' | 'pong' | 'kong' | 'pair';

export interface MeldOptions {
  /** True if the meld was assembled from concealed tiles (not claimed from a discard). */
  concealed: boolean;
  /** Seat of the player whose discard was claimed (omitted for fully concealed melds). */
  claimedFrom?: Wind | undefined;
}

/**
 * A grouping of tiles that contributes to a hand: a chi (sequence), pong (triplet),
 * kong (quad), or pair. Instances are immutable — once melded, the tiles and their
 * arrangement do not change. The `concealed` flag drives faan scoring (concealed
 * melds usually score higher).
 */
export abstract class Meld {
  abstract readonly type: MeldType;
  abstract readonly tiles: readonly Tile[];

  readonly concealed: boolean;
  readonly claimedFrom: Wind | undefined;

  protected constructor(opts: MeldOptions) {
    this.concealed = opts.concealed;
    this.claimedFrom = opts.claimedFrom;
  }

  /** Whether the meld contains a tile of the given type (by `Tile.equals`). */
  contains(tile: Tile): boolean {
    return this.tiles.some((t) => t.equals(tile));
  }

  /** Dash-joined short codes, e.g. "3m-4m-5m" or "E-E-E". */
  toString(): string {
    return this.tiles.map((t) => t.toString()).join('-');
  }
}
