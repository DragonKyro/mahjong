import type { Tile } from '@core/tiles/Tile';
import type { Wind } from '@core/tiles/HonorTile';
import { TileImage } from './TileImage';

interface DiscardPoolProps {
  /** Discards in chronological order from the given seat. */
  tiles: readonly Tile[];
  /** Which side of the table this pool sits on (from the human's perspective). */
  orientation: 'top' | 'right' | 'bottom' | 'left';
  seatLabel: Wind;
  isLastDiscarder: boolean;
}

/**
 * One player's pile of discarded tiles, laid out as a 6-wide grid in the
 * authentic 牌河 ("river") pattern. The pile grows row by row, oldest at the
 * top. A gentle highlight marks the seat whose discard is currently up for claim.
 */
export function DiscardPool({ tiles, orientation, seatLabel, isLastDiscarder }: DiscardPoolProps) {
  const isVertical = orientation === 'left' || orientation === 'right';
  const wrapClass = isVertical
    ? 'grid grid-flow-col grid-rows-6 gap-0.5'
    : 'grid grid-flow-row grid-cols-6 gap-0.5';

  const ringClass = isLastDiscarder
    ? 'ring-2 ring-amber-300/70 rounded-md p-1'
    : 'p-1';

  // The last discarded tile gets a glow so the player can spot the live pickup.
  const lastIdx = tiles.length - 1;

  return (
    <div className={`${ringClass} relative`}>
      <span className="absolute -top-3 left-1 text-[10px] font-bold text-amber-300/80 select-none font-cjk">
        {seatLabel}
      </span>
      <div className={wrapClass}>
        {tiles.map((t, i) => (
          <div
            key={`${t.toString()}-${i}`}
            className={i === lastIdx && isLastDiscarder ? 'drop-shadow-[0_0_4px_rgba(252,211,77,0.9)]' : ''}
          >
            <TileImage tile={t} size="sm" />
          </div>
        ))}
      </div>
    </div>
  );
}
