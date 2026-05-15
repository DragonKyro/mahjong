import { Wind } from '@core/tiles/HonorTile';
import type { Game } from '@core/game/Game';
import type { RoundOutcome, TurnAction, Claim, PlayerView } from '@core/game/types';
import type { Tile } from '@core/tiles/Tile';
import type { Player } from '@core/players/Player';
import { OpponentBar } from './OpponentBar';
import { PlayerHand } from './PlayerHand';
import { CenterArea } from './CenterArea';
import { DiscardPool } from './DiscardPool';
import { TileImage } from './TileImage';
import { ActionPanel, ClaimPanel } from './PendingPanel';
import { OutcomeBanner } from './OutcomeBanner';

export interface GameTablePending {
  kind: 'action' | 'claim';
  view: PlayerView;
  drawn?: Tile | null;
  /** True only on action pending — engine validator has approved a self-draw on `drawn`. */
  canDeclareWin?: boolean;
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
  const lastDiscarder = view?.lastDiscard?.from ?? null;

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
        <TableCenter
          game={game}
          seats={seats}
          prevailingWind={view?.prevailingWind ?? game.prevailingWind}
          dealer={view?.dealer ?? game.dealer}
          wallRemaining={view?.wallRemaining ?? 0}
          lastDiscarder={lastDiscarder}
        />
      </div>

      <div className="col-span-3 row-start-3 flex flex-col items-center gap-2">
        <div className="text-xs opacity-70">
          You — {seats.you.seatWind} seat · bankroll {seats.you.score >= 0 ? '+' : ''}
          {seats.you.score}
        </div>
        {seats.you.hand.melds.length > 0 && (
          <div className="flex gap-2 items-center">
            <span className="text-[11px] opacity-70">Melds:</span>
            {seats.you.hand.melds.map((m, i) => (
              <div key={i} className="flex gap-[1px] bg-stone-900/40 rounded p-0.5">
                {m.tiles.map((t, j) => (
                  <TileImage key={j} tile={t} size="sm" />
                ))}
              </div>
            ))}
          </div>
        )}
        {seats.you.hand.bonuses.length > 0 && (
          <div className="flex gap-1 items-center">
            <span className="text-[11px] opacity-70">Bonus:</span>
            {seats.you.hand.bonuses.map((b, i) => (
              <TileImage key={i} tile={b} size="sm" />
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
            canDeclareWin={pending.canDeclareWin ?? false}
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
            players={game.players}
            scoreTable={game.scoreTable}
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

interface TableCenterProps {
  game: Game;
  seats: Seats;
  prevailingWind: Wind;
  dealer: Wind;
  wallRemaining: number;
  lastDiscarder: Wind | null;
}

/**
 * The four discard rivers wrapped around the central game-info card. Tries to
 * recreate the look of a physical mahjong table: each player's discards sit in
 * front of their seat (from the human's perspective).
 */
function TableCenter(props: TableCenterProps) {
  const { game, seats, prevailingWind, dealer, wallRemaining, lastDiscarder } = props;
  return (
    <div className="grid grid-cols-[auto_1fr_auto] grid-rows-[auto_1fr_auto] gap-3 min-h-[360px] bg-emerald-950/40 rounded-xl p-3 border border-emerald-900/60 shadow-inner items-center justify-items-center">
      <div className="col-start-2 row-start-1">
        <DiscardPool
          tiles={seats.top.discards}
          orientation="top"
          seatLabel={seats.top.seatWind}
          isLastDiscarder={lastDiscarder === seats.top.seatWind}
        />
      </div>
      <div className="col-start-1 row-start-2">
        <DiscardPool
          tiles={seats.left.discards}
          orientation="left"
          seatLabel={seats.left.seatWind}
          isLastDiscarder={lastDiscarder === seats.left.seatWind}
        />
      </div>
      <div className="col-start-2 row-start-2">
        <CenterArea
          prevailingWind={prevailingWind}
          dealer={dealer}
          wallRemaining={wallRemaining}
          roundNumber={game.history.length + 1}
        />
      </div>
      <div className="col-start-3 row-start-2">
        <DiscardPool
          tiles={seats.right.discards}
          orientation="right"
          seatLabel={seats.right.seatWind}
          isLastDiscarder={lastDiscarder === seats.right.seatWind}
        />
      </div>
      <div className="col-start-2 row-start-3">
        <DiscardPool
          tiles={seats.you.discards}
          orientation="bottom"
          seatLabel={seats.you.seatWind}
          isLastDiscarder={lastDiscarder === seats.you.seatWind}
        />
      </div>
    </div>
  );
}

interface Seats {
  you: Player;
  right: Player;
  top: Player;
  left: Player;
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
