import { useEffect } from 'react';
import { useTrainingStore } from '@store/trainingStore';
import { TileImage } from './TileImage';
import type { Tile } from '@core/tiles/Tile';
import type { DiscardAnalysis } from '@training/Ukeire';

export function TrainingPage() {
  const puzzle = useTrainingStore((s) => s.puzzle);
  const guess = useTrainingStore((s) => s.guess);
  const revealed = useTrainingStore((s) => s.revealed);
  const progress = useTrainingStore((s) => s.progress);
  const newPuzzle = useTrainingStore((s) => s.newPuzzle);
  const submitGuess = useTrainingStore((s) => s.submitGuess);

  // Lazy-init a puzzle on first render.
  useEffect(() => {
    if (puzzle === null) newPuzzle();
  }, [puzzle, newPuzzle]);

  if (!puzzle) {
    return (
      <div className="min-h-screen bg-felt-dark text-white flex items-center justify-center font-cjk">
        Generating puzzle…
      </div>
    );
  }

  const correct = revealed && guess !== null && puzzle.optimal.discard.equals(guess);
  const accuracy = progress.total > 0 ? Math.round((progress.correct / progress.total) * 100) : 0;

  return (
    <div className="min-h-screen bg-felt-dark text-white font-cjk p-6 flex flex-col items-center gap-4">
      <header className="w-full max-w-3xl flex justify-between items-baseline">
        <h2 className="text-xl font-bold">Training — Optimal Discard</h2>
        <div className="text-xs opacity-80">
          {progress.correct} / {progress.total} ({accuracy}%) · streak {progress.currentStreak} · best{' '}
          {progress.bestStreak}
        </div>
      </header>

      <p className="text-sm opacity-70 max-w-2xl text-center">
        Pick the tile to discard. Lower shanten and higher acceptance are better — terminals and
        honors tend to be safer to throw away early.
      </p>

      <div className="bg-felt rounded-lg p-4 flex flex-wrap justify-center gap-1">
        {puzzle.hand.map((t, i) => (
          <DiscardButton
            key={`${t.toString()}-${i}`}
            tile={t}
            disabled={revealed}
            picked={guess?.equals(t) ?? false}
            optimal={revealed && puzzle.optimal.discard.equals(t)}
            onClick={() => submitGuess(t)}
          />
        ))}
      </div>

      {revealed && (
        <AnswerReveal
          analyses={puzzle.analyses}
          optimal={puzzle.optimal}
          guess={guess!}
          correct={correct}
          onNext={() => newPuzzle()}
        />
      )}
    </div>
  );
}

interface DiscardButtonProps {
  tile: Tile;
  disabled: boolean;
  picked: boolean;
  optimal: boolean;
  onClick: () => void;
}

function DiscardButton({ tile, disabled, picked, optimal, onClick }: DiscardButtonProps) {
  const outline = optimal
    ? 'outline-emerald-400 outline-4'
    : picked
      ? 'outline-rose-400 outline-4'
      : '';
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`${outline} outline outline-transparent rounded-sm hover:-translate-y-1 transition-transform enabled:cursor-pointer disabled:cursor-default`}
    >
      <TileImage tile={tile} size="lg" />
    </button>
  );
}

interface AnswerRevealProps {
  analyses: DiscardAnalysis[];
  optimal: DiscardAnalysis;
  guess: Tile;
  correct: boolean;
  onNext: () => void;
}

function AnswerReveal({ analyses, optimal, guess, correct, onNext }: AnswerRevealProps) {
  const guessAnalysis = analyses.find((a) => a.discard.equals(guess));
  return (
    <div className="w-full max-w-3xl bg-stone-900/60 rounded-lg p-4 flex flex-col gap-3 border border-stone-700">
      <div
        className={`text-lg font-bold ${correct ? 'text-emerald-400' : 'text-rose-400'}`}
      >
        {correct
          ? 'Optimal!'
          : `Optimal is ${optimal.discard.toString()} — you picked ${guess.toString()}`}
      </div>
      {!correct && guessAnalysis && (
        <ComparisonRow label="Your pick" a={guessAnalysis} />
      )}
      <ComparisonRow label="Optimal" a={optimal} />
      <details className="text-xs">
        <summary className="cursor-pointer opacity-80">Show all discard options</summary>
        <table className="w-full text-xs mt-2 border-collapse">
          <thead>
            <tr className="opacity-70 text-left">
              <th className="py-1 pr-2">Discard</th>
              <th className="py-1 pr-2">Shanten</th>
              <th className="py-1 pr-2">Acceptance</th>
              <th className="py-1">Waits</th>
            </tr>
          </thead>
          <tbody>
            {[...analyses]
              .sort((x, y) => x.shanten - y.shanten || y.acceptance - x.acceptance)
              .map((a) => (
                <tr
                  key={a.discard.toString()}
                  className={`border-t border-stone-700 ${a === optimal ? 'text-emerald-300' : ''}`}
                >
                  <td className="py-1 pr-2 font-mono">{a.discard.toString()}</td>
                  <td className="py-1 pr-2">{a.shanten}</td>
                  <td className="py-1 pr-2">{a.acceptance}</td>
                  <td className="py-1 text-[10px]">
                    {a.waits
                      .map((w) => `${w.tile.toString()}×${w.remaining}`)
                      .join(' ')}
                  </td>
                </tr>
              ))}
          </tbody>
        </table>
      </details>
      <button
        type="button"
        onClick={onNext}
        className="self-end px-4 py-1 bg-amber-700 hover:bg-amber-600 rounded text-sm"
      >
        Next puzzle
      </button>
    </div>
  );
}

function ComparisonRow({ label, a }: { label: string; a: DiscardAnalysis }) {
  return (
    <div className="flex items-center gap-3 text-sm">
      <span className="w-20 opacity-80">{label}:</span>
      <TileImage tile={a.discard} size="sm" />
      <span>
        shanten <span className="font-bold">{a.shanten}</span>
      </span>
      <span>
        acceptance <span className="font-bold">{a.acceptance}</span>
      </span>
      {a.waits.length > 0 && (
        <span className="text-xs opacity-80">
          waits: {a.waits.map((w) => `${w.tile.toString()}×${w.remaining}`).join(' ')}
        </span>
      )}
    </div>
  );
}
