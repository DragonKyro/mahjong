import type { Wind } from '@core/tiles/HonorTile';
import { tileBackUrl } from '../tileAsset';

interface CenterAreaProps {
  prevailingWind: Wind;
  dealer: Wind;
  wallRemaining: number;
  roundNumber: number;
}

/**
 * The compact game-info card that sits in the middle of the table, surrounded
 * by the four discard rivers. Discards are rendered by `DiscardPool` outside
 * this component — keep this stateless and small.
 */
export function CenterArea({
  prevailingWind,
  dealer,
  wallRemaining,
  roundNumber,
}: CenterAreaProps) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 bg-felt rounded-lg p-3 border border-amber-900/40 shadow-inner min-w-[150px]">
      <div className="grid grid-cols-2 gap-x-3 gap-y-1 text-xs opacity-90">
        <span className="opacity-70">Round</span>
        <span className="font-bold text-amber-300">#{roundNumber}</span>
        <span className="opacity-70">圈風</span>
        <span className="font-bold text-amber-300">{prevailingWind}</span>
        <span className="opacity-70">莊家</span>
        <span className="font-bold text-amber-300">{dealer}</span>
      </div>
      <WallVisual remaining={wallRemaining} />
    </div>
  );
}

/**
 * A small visualization of the live wall: a tight row of face-down tile backs
 * representing tiles still to be drawn, plus the numeric remaining count below.
 * For readability we cap the visual at a fixed width; the numeric counter is
 * the source of truth.
 */
function WallVisual({ remaining }: { remaining: number }) {
  const MAX_VISUAL = 14;
  const shown = Math.min(MAX_VISUAL, Math.ceil(remaining / 6));
  return (
    <div className="flex flex-col items-center gap-1 mt-1">
      <div className="flex gap-[1px]">
        {Array.from({ length: shown }).map((_, i) => (
          <img
            key={i}
            src={tileBackUrl()}
            alt=""
            className="w-2 h-4 rounded-[1px] bg-emerald-900 border border-emerald-950"
          />
        ))}
      </div>
      <span className="text-[10px] opacity-70">
        wall: <span className="font-bold">{remaining}</span>
      </span>
    </div>
  );
}
