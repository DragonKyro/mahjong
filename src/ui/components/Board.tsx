import { useGameStore, DIFFICULTIES } from '@store/gameStore';
import { Wind } from '@core/tiles/HonorTile';
import { GameTable, type GameTablePending } from './GameTable';

/** Single-player wrapper around `GameTable`, pulling state from `gameStore`. */
export function Board() {
  // `tick` subscription forces re-render on every engine event.
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

  const tablePending: GameTablePending | null = pending
    ? pending.kind === 'action'
      ? { kind: 'action', view: pending.view, drawn: pending.drawn }
      : { kind: 'claim', view: pending.view, discard: pending.discard, options: pending.options }
    : null;

  return (
    <GameTable
      game={game}
      pending={tablePending}
      outcome={outcome}
      mySeat={Wind.East}
      inProgress={inProgress}
      resolveAction={resolveAction}
      resolveClaim={resolveClaim}
      onNewRound={() => void startRound()}
    />
  );
}
