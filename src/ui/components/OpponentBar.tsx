import type { Player } from '@core/players/Player';

interface OpponentBarProps {
  player: Player;
  orientation: 'top' | 'left' | 'right';
  isActive?: boolean;
}

/** Compact summary of an opponent's seat: name, concealed tile count, melds, discards. */
export function OpponentBar({ player, orientation, isActive }: OpponentBarProps) {
  const handCount = player.hand.concealed.length;
  const ringClass = isActive ? 'ring-2 ring-amber-300' : '';
  const orientationClass =
    orientation === 'top' ? 'flex-col items-center' : 'flex-col items-stretch';
  return (
    <div className={`bg-felt rounded-lg p-2 ${orientationClass} flex gap-1 ${ringClass}`}>
      <div className="text-xs opacity-80 flex justify-between gap-2">
        <span className="font-semibold">{player.name}</span>
        <span>
          ({player.seatWind}) · {handCount} tiles · {player.score >= 0 ? '+' : ''}
          {player.score}
        </span>
      </div>
      <MeldStrip melds={player.hand.melds} />
      <DiscardGrid tiles={player.discards} />
    </div>
  );
}

function MeldStrip({ melds }: { melds: ReadonlyArray<{ tiles: readonly { toString(): string }[] }> }) {
  if (melds.length === 0) return null;
  return (
    <div className="flex flex-wrap gap-2 text-[10px] opacity-90">
      {melds.map((m, i) => (
        <div key={i} className="flex gap-0.5">
          {m.tiles.map((t, j) => {
            // Need the actual Tile object to render; the upstream MeldStrip caller
            // should pass tiles, but for simplicity we render text fallbacks here.
            return (
              <span
                key={j}
                className="px-1 py-0.5 bg-stone-100 text-stone-900 rounded-sm border border-stone-300"
              >
                {t.toString()}
              </span>
            );
          })}
        </div>
      ))}
    </div>
  );
}

function DiscardGrid({ tiles }: { tiles: ReadonlyArray<{ toString(): string }> }) {
  if (tiles.length === 0) {
    return <div className="text-[10px] opacity-50 italic">no discards yet</div>;
  }
  return (
    <div className="flex flex-wrap gap-0.5 max-h-24 overflow-hidden">
      {tiles.slice(-18).map((t, i) => (
        <span
          key={i}
          className="px-1 py-0.5 bg-stone-200 text-stone-900 rounded-sm text-[10px] border border-stone-300"
        >
          {t.toString()}
        </span>
      ))}
    </div>
  );
}

