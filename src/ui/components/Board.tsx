import { useGameStore, DIFFICULTIES } from '@store/gameStore';
import { OpponentBar } from './OpponentBar';
import { PlayerHand } from './PlayerHand';
import { CenterArea } from './CenterArea';
import { ActionPanel, ClaimPanel } from './PendingPanel';
import { OutcomeBanner } from './OutcomeBanner';
import { Wind } from '@core/tiles/HonorTile';

export function Board() {
  // `tick` subscription keeps the component re-rendering after each engine event.
  // We don't read it but referencing it puts the store on Zustand's subscription list.
  const tick = useGameStore((s) => s.tick);
  void tick;

  const game = useGameStore((s) => s.game);
  const pending = useGameStore((s) => s.pending);
  const outcome = useGameStore((s) => s.outcome);
  const inProgress = useGameStore((s) => s.inProgress);
  const difficulty = useGameStore((s) => s.difficulty);
  const setDifficulty = useGameStore((s) => s.setDifficulty);
  const startRound = useGameStore((s) => s.startRound);
  const resolveAction = useGameStore((s) => s.resolveAction);
  const resolveClaim = useGameStore((s) => s.resolveClaim);

  if (!game) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen gap-4 p-8 bg-felt-dark text-white font-cjk">
        <h1 className="text-4xl font-bold">廣東麻雀</h1>
        <p className="opacity-80">Cantonese Mahjong</p>
        <label className="flex flex-col items-center gap-1 mt-4">
          <span className="text-sm opacity-70">AI difficulty</span>
          <select
            value={difficulty}
            onChange={(e) => setDifficulty(e.target.value as typeof difficulty)}
            className="bg-stone-700 text-white rounded px-3 py-1"
          >
            {DIFFICULTIES.map((d) => (
              <option key={d.value} value={d.value}>
                {d.label}
              </option>
            ))}
          </select>
        </label>
        <button
          type="button"
          className="mt-2 px-6 py-2 bg-amber-700 hover:bg-amber-600 rounded text-lg"
          onClick={() => void startRound()}
        >
          Start round
        </button>
      </div>
    );
  }

  const [you, south, west, north] = game.players;
  // Use the view captured in `pending` if available (most accurate / serialization-ready);
  // otherwise fall back to direct player reads (no-op when pending is set).
  const view = pending?.view;

  return (
    <div className="min-h-screen bg-felt-dark text-white p-4 font-cjk grid grid-cols-[200px_1fr_200px] grid-rows-[auto_1fr_auto_auto] gap-3">
      {/* Top: West opponent (對家) */}
      <div className="col-start-2 row-start-1">
        <OpponentBar player={west} orientation="top" />
      </div>

      {/* Left: North opponent (上家) */}
      <div className="col-start-1 row-start-2">
        <OpponentBar player={north} orientation="left" />
      </div>

      {/* Right: South opponent (下家) */}
      <div className="col-start-3 row-start-2">
        <OpponentBar player={south} orientation="right" />
      </div>

      {/* Center: round status + last discard */}
      <div className="col-start-2 row-start-2">
        <CenterArea
          prevailingWind={view?.prevailingWind ?? game.prevailingWind}
          dealer={view?.dealer ?? game.dealer}
          wallRemaining={view?.wallRemaining ?? 0}
          lastDiscard={view?.lastDiscard ?? null}
        />
      </div>

      {/* Bottom: your hand + meld strip + status */}
      <div className="col-span-3 row-start-3 flex flex-col items-center gap-2">
        <div className="text-xs opacity-70">
          You — East seat · score {you.score >= 0 ? '+' : ''}
          {you.score} · bonus: {you.hand.bonuses.map((b) => b.toString()).join(' ') || '—'}
        </div>
        {you.hand.melds.length > 0 && (
          <div className="text-[11px] flex gap-2 opacity-90">
            Melds:{' '}
            {you.hand.melds.map((m, i) => (
              <span key={i} className="bg-stone-200 text-stone-900 rounded px-1">
                {m.toString()}
              </span>
            ))}
          </div>
        )}
        <PlayerHand
          tiles={you.hand.concealed}
          drawnTile={pending?.kind === 'action' ? pending.drawn : null}
          onDiscard={
            pending?.kind === 'action'
              ? (tile) => resolveAction({ kind: 'discard', tile })
              : undefined
          }
        />
      </div>

      {/* Bottom: contextual action / claim panel */}
      <div className="col-span-3 row-start-4 flex justify-center">
        {pending?.kind === 'action' && (
          <ActionPanel
            drawn={pending.drawn}
            hand={pending.view.self.hand}
            onResolve={resolveAction}
          />
        )}
        {pending?.kind === 'claim' && (
          <ClaimPanel discard={pending.discard} options={pending.options} onResolve={resolveClaim} />
        )}
        {outcome && !pending && (
          <OutcomeBanner outcome={outcome} onNewRound={() => void startRound()} />
        )}
        {!pending && !outcome && inProgress && (
          <div className="text-xs opacity-60 italic">AI is thinking…</div>
        )}
      </div>

      {/* Reference Wind enum to silence unused-import lint; helps when adding wind-specific UI */}
      <span className="hidden">{Wind.East}</span>
    </div>
  );
}
