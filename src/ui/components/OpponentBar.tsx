import type { Player } from '@core/players/Player';
import type { Tile } from '@core/tiles/Tile';
import { TileImage } from './TileImage';
import { tileBackUrl } from '../tileAsset';

interface OpponentBarProps {
  player: Player;
  orientation: 'top' | 'left' | 'right';
  isActive?: boolean;
}

/**
 * Compact summary of an opponent's seat: name, face-down concealed tiles
 * (only the count is visible to opponents), exposed melds, bonus pile, and
 * running score. Discards are NOT shown here — they live in the center pool.
 */
export function OpponentBar({ player, orientation, isActive }: OpponentBarProps) {
  const handCount = player.hand.concealed.length;
  const ringClass = isActive ? 'ring-2 ring-amber-300' : '';
  const isVertical = orientation === 'left' || orientation === 'right';

  return (
    <div className={`bg-felt rounded-lg p-2 flex flex-col gap-2 ${ringClass}`}>
      <div className="text-xs opacity-90 flex justify-between gap-2 items-center">
        <span className="font-semibold truncate">{player.name}</span>
        <span className="opacity-80">
          ({player.seatWind}) {player.score >= 0 ? '+' : ''}
          {player.score}
        </span>
      </div>
      <FaceDownRow count={handCount} orientation={orientation} />
      <MeldStrip melds={player.hand.melds} vertical={isVertical} />
      <BonusStrip bonuses={player.hand.bonuses} />
    </div>
  );
}

function FaceDownRow({
  count,
  orientation,
}: {
  count: number;
  orientation: 'top' | 'left' | 'right';
}) {
  if (count <= 0) return null;
  const isVertical = orientation === 'left' || orientation === 'right';
  const wrapClass = isVertical
    ? 'grid grid-cols-2 gap-[1px]'
    : 'flex flex-wrap gap-[1px]';
  return (
    <div className={wrapClass}>
      {Array.from({ length: count }).map((_, i) => (
        <img
          key={i}
          src={tileBackUrl()}
          alt=""
          className="w-5 h-7 rounded-sm border border-stone-700 bg-stone-100"
        />
      ))}
    </div>
  );
}

function MeldStrip({
  melds,
  vertical,
}: {
  melds: ReadonlyArray<{ tiles: readonly Tile[] }>;
  vertical: boolean;
}) {
  if (melds.length === 0) return null;
  return (
    <div className={vertical ? 'flex flex-col gap-1' : 'flex flex-wrap gap-1'}>
      {melds.map((m, i) => (
        <div key={i} className="flex gap-[1px] bg-stone-900/40 rounded p-0.5">
          {m.tiles.map((t, j) => (
            <TileImage key={j} tile={t} size="sm" />
          ))}
        </div>
      ))}
    </div>
  );
}

function BonusStrip({ bonuses }: { bonuses: ReadonlyArray<Tile> }) {
  if (bonuses.length === 0) return null;
  return (
    <div className="flex flex-wrap gap-[1px]">
      {bonuses.map((b, i) => (
        <TileImage key={i} tile={b} size="sm" />
      ))}
    </div>
  );
}
