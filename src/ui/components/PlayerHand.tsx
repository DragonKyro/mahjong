import type { Tile } from '@core/tiles/Tile';
import { TileImage } from './TileImage';

interface PlayerHandProps {
  tiles: readonly Tile[];
  /** Tile that was just drawn — visually separated to the right. */
  drawnTile: Tile | null | undefined;
  /** Click handler for discarding. If absent, tiles aren't clickable. */
  onDiscard: ((tile: Tile) => void) | undefined;
}

export function PlayerHand({ tiles, drawnTile, onDiscard }: PlayerHandProps) {
  // If `drawnTile` is supplied AND it matches one of the tiles in hand, pull
  // it out and display separately. Otherwise show the whole hand sorted.
  let mainTiles: readonly Tile[] = tiles;
  let drawn: Tile | null = null;
  if (drawnTile) {
    const idx = tiles.findIndex((t) => t.equals(drawnTile));
    if (idx !== -1) {
      mainTiles = [...tiles.slice(0, idx), ...tiles.slice(idx + 1)];
      drawn = tiles[idx]!;
    }
  }

  return (
    <div className="flex items-end justify-center gap-1">
      <div className="flex gap-1">
        {mainTiles.map((t, i) => (
          <button
            key={`${t.toString()}-${i}`}
            type="button"
            onClick={() => onDiscard?.(t)}
            disabled={!onDiscard}
            className="hover:-translate-y-1 transition-transform enabled:cursor-pointer disabled:cursor-default"
          >
            <TileImage tile={t} size="lg" />
          </button>
        ))}
      </div>
      {drawn && (
        <button
          type="button"
          onClick={() => onDiscard?.(drawn)}
          disabled={!onDiscard}
          className="ml-2 hover:-translate-y-1 transition-transform enabled:cursor-pointer disabled:cursor-default"
        >
          <TileImage tile={drawn} size="lg" />
        </button>
      )}
    </div>
  );
}
