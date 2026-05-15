import type { Tile } from '@core/tiles/Tile';
import type { Wind } from '@core/tiles/HonorTile';
import { TileImage } from './TileImage';

interface CenterAreaProps {
  prevailingWind: Wind;
  dealer: Wind;
  wallRemaining: number;
  lastDiscard: { tile: Tile; from: Wind } | null;
}

export function CenterArea({ prevailingWind, dealer, wallRemaining, lastDiscard }: CenterAreaProps) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 bg-felt rounded-lg p-4 min-h-[200px]">
      <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs opacity-80">
        <span>Prevailing wind</span>
        <span className="font-bold text-amber-300">{prevailingWind}</span>
        <span>Dealer (莊)</span>
        <span className="font-bold text-amber-300">{dealer}</span>
        <span>Wall remaining</span>
        <span className="font-bold">{wallRemaining}</span>
      </div>
      {lastDiscard && (
        <div className="flex flex-col items-center gap-1 mt-2">
          <span className="text-[10px] opacity-70">Last discard from {lastDiscard.from}</span>
          <TileImage tile={lastDiscard.tile} size="md" />
        </div>
      )}
    </div>
  );
}
