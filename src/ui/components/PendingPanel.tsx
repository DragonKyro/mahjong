import type { TurnAction, Claim } from '@core/game/types';
import type { Tile } from '@core/tiles/Tile';
import { TileImage } from './TileImage';

interface ActionPanelProps {
  drawn: Tile | null;
  onDiscard?: (tile: Tile) => void; // discard handled at PlayerHand level
  // Surface kong / win actions when they're legal — Phase 4 MVP just shows a hint
  hand: readonly Tile[];
  /** True only when the engine's win validator approves a self-draw on `drawn`. */
  canDeclareWin: boolean;
  onResolve: (action: TurnAction) => void;
}

export function ActionPanel({ drawn, hand, canDeclareWin, onResolve }: ActionPanelProps) {
  const fourOfKind = findFourOfKind(hand);

  return (
    <div className="flex flex-col items-center gap-2 p-3 bg-amber-950/40 rounded-lg border border-amber-700/40">
      <div className="text-sm flex items-center gap-3">
        <span>Your turn —</span>
        {drawn ? (
          <span className="flex items-center gap-2">
            drew <TileImage tile={drawn} size="sm" />
          </span>
        ) : (
          <span>discard a tile to continue</span>
        )}
      </div>
      <div className="flex gap-2">
        {fourOfKind && (
          <button
            type="button"
            className="px-3 py-1 bg-blue-700 hover:bg-blue-600 rounded text-sm"
            onClick={() => onResolve({ kind: 'self-kong', tile: fourOfKind })}
          >
            Declare kong (暗槓 {fourOfKind.toString()})
          </button>
        )}
        {canDeclareWin && (
          <button
            type="button"
            className="px-3 py-1 bg-emerald-700 hover:bg-emerald-600 rounded text-sm"
            onClick={() => onResolve({ kind: 'win' })}
          >
            Declare win (自摸)
          </button>
        )}
      </div>
      <div className="text-xs opacity-70">Click any tile in your hand to discard.</div>
    </div>
  );
}

interface ClaimPanelProps {
  discard: Tile;
  options: readonly Claim[];
  onResolve: (claim: Claim) => void;
}

export function ClaimPanel({ discard, options, onResolve }: ClaimPanelProps) {
  return (
    <div className="flex flex-col items-center gap-2 p-3 bg-rose-950/40 rounded-lg border border-rose-700/40">
      <div className="text-sm flex items-center gap-2">
        <span>Discard:</span>
        <TileImage tile={discard} size="sm" />
        <span>— claim?</span>
      </div>
      <div className="flex flex-wrap gap-2">
        {options.map((opt, i) => (
          <button
            key={`${opt.kind}-${i}`}
            type="button"
            className={buttonClass(opt.kind)}
            onClick={() => onResolve(opt)}
          >
            {labelFor(opt)}
          </button>
        ))}
      </div>
    </div>
  );
}

function buttonClass(kind: Claim['kind']): string {
  const base = 'px-3 py-1 rounded text-sm';
  if (kind === 'pass') return `${base} bg-stone-700 hover:bg-stone-600`;
  if (kind === 'win') return `${base} bg-emerald-700 hover:bg-emerald-600`;
  if (kind === 'kong') return `${base} bg-blue-700 hover:bg-blue-600`;
  if (kind === 'pong') return `${base} bg-indigo-700 hover:bg-indigo-600`;
  return `${base} bg-purple-700 hover:bg-purple-600`;
}

function labelFor(c: Claim): string {
  switch (c.kind) {
    case 'pass':
      return 'Pass';
    case 'win':
      return 'Win (食糊)';
    case 'kong':
      return 'Kong (槓)';
    case 'pong':
      return 'Pong (碰)';
    case 'chi':
      return `Chi (${c.helpers[0].toString()},${c.helpers[1].toString()})`;
  }
}

function findFourOfKind(hand: readonly Tile[]): Tile | null {
  const counts = new Map<string, { tile: Tile; n: number }>();
  for (const t of hand) {
    const e = counts.get(t.toString());
    if (e) e.n++;
    else counts.set(t.toString(), { tile: t, n: 1 });
  }
  for (const v of counts.values()) {
    if (v.n === 4) return v.tile;
  }
  return null;
}
