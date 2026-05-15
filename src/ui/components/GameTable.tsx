import { Wind } from '@core/tiles/HonorTile';
import type { Game } from '@core/game/Game';
import type { RoundOutcome, TurnAction, Claim, PlayerView } from '@core/game/types';
import type { Tile } from '@core/tiles/Tile';
import { OpponentBar } from './OpponentBar';
import { PlayerHand } from './PlayerHand';
import { CenterArea } from './CenterArea';
import { ActionPanel, ClaimPanel } from './PendingPanel';
import { OutcomeBanner } from './OutcomeBanner';

export interface GameTablePending {
  kind: 'action' | 'claim';
  view: PlayerView;
  drawn?: Tile | null;
  discard?: Tile;
  options?: readonly Claim[];
}

export interface GameTableProps {
  game: Game;
  pending: GameTablePending | null;
  outcome: RoundOutcome | null;
  /** Wind of the human seat — used to identify which Player is "you". */
  mySeat: Wind;
  /** True while between human turns; renders a small "thinking" hint. */
  inProgress: boolean;
  resolveAction: (action: TurnAction) => void;
  resolveClaim: (claim: Claim) => void;
  /** If supplied, a "Next round" button is shown on outcome. */
  onNewRound?: () => void;
}

/**
 * Stateless table renderer. Both Board (single-player) and MultiplayerPage feed
 * it the same prop shape, so the visual layout is shared.
 */
export function GameTable(props: GameTableProps) {
  const { game, pending, outcome, mySeat, inProgress, resolveAction, resolveClaim, onNewRound } =
    props;
  const view = pending?.view;
  const seats = orderedSeats(game, mySeat);

  return (
    <div className="min-h-[80vh] bg-felt-dark text-white p-4 font-cjk grid grid-cols-[200px_1fr_200px] grid-rows-[auto_1fr_auto_auto] gap-3">
      <div className="col-start-2 row-start-1">
        <OpponentBar player={seats.top} orientation="top" />
      </div>
      <div className="col-start-1 row-start-2">
        <OpponentBar player={seats.left} orientation="left" />
      </div>
      <div className="col-start-3 row-start-2">
        <OpponentBar player={seats.right} orientation="right" />
      </div>

      <div className="col-start-2 row-start-2">
        <CenterArea
          prevailingWind={view?.prevailingWind ?? game.prevailingWind}
          dealer={view?.dealer ?? game.dealer}
          wallRemaining={view?.wallRemaining ?? 0}
          lastDiscard={view?.lastDiscard ?? null}
        />
      </div>

      <div className="col-span-3 row-start-3 flex flex-col items-center gap-2">
        <div className="text-xs opacity-70">
          You — {seats.you.seatWind} seat · score {seats.you.score >= 0 ? '+' : ''}
          {seats.you.score} · bonus:{' '}
          {seats.you.hand.bonuses.map((b) => b.toString()).join(' ') || '—'}
        </div>
        {seats.you.hand.melds.length > 0 && (
          <div className="text-[11px] flex gap-2 opacity-90">
            Melds:{' '}
            {seats.you.hand.melds.map((m, i) => (
              <span key={i} className="bg-stone-200 text-stone-900 rounded px-1">
                {m.toString()}
              </span>
            ))}
          </div>
        )}
        <PlayerHand
          tiles={seats.you.hand.concealed}
          drawnTile={pending?.kind === 'action' ? (pending.drawn ?? null) : null}
          onDiscard={
            pending?.kind === 'action'
              ? (tile) => resolveAction({ kind: 'discard', tile })
              : undefined
          }
        />
      </div>

      <div className="col-span-3 row-start-4 flex justify-center">
        {pending?.kind === 'action' && (
          <ActionPanel
            drawn={pending.drawn ?? null}
            hand={pending.view.self.hand}
            onResolve={resolveAction}
          />
        )}
        {pending?.kind === 'claim' && pending.discard && pending.options && (
          <ClaimPanel
            discard={pending.discard}
            options={pending.options}
            onResolve={resolveClaim}
          />
        )}
        {outcome && !pending && (
          <OutcomeBanner
            outcome={outcome}
            onNewRound={onNewRound ?? (() => {})}
          />
        )}
        {!pending && !outcome && inProgress && (
          <div className="text-xs opacity-60 italic">Waiting…</div>
        )}
      </div>

      <span className="hidden">{Wind.East}</span>
    </div>
  );
}

interface Seats {
  you: Game['players'][number];
  right: Game['players'][number];
  top: Game['players'][number];
  left: Game['players'][number];
}

/** Rotate the four players so the human (`mySeat`) sits at the bottom, 下家 on the right, 對家 on top, 上家 on the left. */
function orderedSeats(game: Game, mySeat: Wind): Seats {
  const order: Wind[] = [Wind.East, Wind.South, Wind.West, Wind.North];
  const startIdx = order.indexOf(mySeat);
  return {
    you: game.players[startIdx]!,
    right: game.players[(startIdx + 1) % 4]!,
    top: game.players[(startIdx + 2) % 4]!,
    left: game.players[(startIdx + 3) % 4]!,
  };
}
