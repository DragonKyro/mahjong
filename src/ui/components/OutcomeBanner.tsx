import type { RoundOutcome } from '@core/game/types';

interface OutcomeBannerProps {
  outcome: RoundOutcome;
  onNewRound: () => void;
}

export function OutcomeBanner({ outcome, onNewRound }: OutcomeBannerProps) {
  if (outcome.kind === 'draw') {
    return (
      <div className="bg-stone-700/80 rounded-lg p-4 flex flex-col items-center gap-2">
        <h2 className="text-xl font-bold">流局 — Wall exhausted, no winner</h2>
        <button
          type="button"
          className="px-4 py-1 bg-amber-700 hover:bg-amber-600 rounded"
          onClick={onNewRound}
        >
          Next round
        </button>
      </div>
    );
  }

  const { winner, from, faan } = outcome;
  return (
    <div className="bg-emerald-800/80 rounded-lg p-4 flex flex-col items-center gap-2">
      <h2 className="text-xl font-bold">
        {winner} wins {from === null ? '(自摸)' : `(食糊 from ${from})`}
      </h2>
      {faan && (
        <>
          <div className="text-sm">
            {faan.total} 番 {faan.isLimit && '(LIMIT 滿胡)'}
          </div>
          <ul className="text-xs grid grid-cols-2 gap-x-4 gap-y-1 max-w-md">
            {faan.entries.map((e, i) => (
              <li key={i} className="flex justify-between">
                <span>{e.label}</span>
                <span className="font-bold">+{e.faan}</span>
              </li>
            ))}
          </ul>
        </>
      )}
      <button
        type="button"
        className="mt-2 px-4 py-1 bg-amber-700 hover:bg-amber-600 rounded"
        onClick={onNewRound}
      >
        Next round
      </button>
    </div>
  );
}
