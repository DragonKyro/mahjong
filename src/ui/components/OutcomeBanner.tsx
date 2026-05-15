import type { RoundOutcome } from '@core/game/types';
import type { ScoreTable } from '@core/scoring/ScoreTable';
import type { Player } from '@core/players/Player';
import { Wind, SEAT_ORDER } from '@core/tiles/HonorTile';

interface OutcomeBannerProps {
  outcome: RoundOutcome;
  players: readonly Player[];
  scoreTable: ScoreTable;
  onNewRound: () => void;
}

export function OutcomeBanner({ outcome, players, scoreTable, onNewRound }: OutcomeBannerProps) {
  const deltas = computeDeltas(outcome, scoreTable);

  if (outcome.kind === 'draw') {
    return (
      <div className="bg-stone-700/80 rounded-lg p-4 flex flex-col items-center gap-3">
        <h2 className="text-xl font-bold">流局 — Wall exhausted, no winner</h2>
        <ScoreSheet players={players} deltas={deltas} />
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
    <div className="bg-emerald-800/80 rounded-lg p-4 flex flex-col items-center gap-3">
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
      <ScoreSheet players={players} deltas={deltas} />
      <button
        type="button"
        className="mt-1 px-4 py-1 bg-amber-700 hover:bg-amber-600 rounded"
        onClick={onNewRound}
      >
        Next round
      </button>
    </div>
  );
}

function ScoreSheet({
  players,
  deltas,
}: {
  players: readonly Player[];
  deltas: Map<Wind, number>;
}) {
  return (
    <div className="bg-stone-900/60 rounded p-2 text-xs grid grid-cols-[auto_auto_auto_auto] gap-x-4 gap-y-1 min-w-[280px]">
      <span className="opacity-70">Seat</span>
      <span className="opacity-70">Player</span>
      <span className="opacity-70 text-right">Δ</span>
      <span className="opacity-70 text-right">Bankroll</span>
      {SEAT_ORDER.map((wind) => {
        const p = players.find((pl) => pl.seatWind === wind);
        if (!p) return null;
        const delta = deltas.get(wind) ?? 0;
        const deltaClass =
          delta > 0 ? 'text-emerald-300' : delta < 0 ? 'text-rose-300' : 'opacity-60';
        return (
          <div key={wind} className="contents">
            <span className="font-bold text-amber-300">{wind}</span>
            <span>{p.name}</span>
            <span className={`text-right ${deltaClass}`}>
              {delta > 0 ? '+' : ''}
              {delta}
            </span>
            <span className="text-right font-bold">
              {p.score >= 0 ? '+' : ''}
              {p.score}
            </span>
          </div>
        );
      })}
    </div>
  );
}

function computeDeltas(outcome: RoundOutcome, scoreTable: ScoreTable): Map<Wind, number> {
  if (outcome.kind === 'draw' || !outcome.faan) {
    return new Map(SEAT_ORDER.map((w) => [w, 0]));
  }
  return scoreTable.scoreWin({
    faan: outcome.faan.total,
    winnerSeat: outcome.winner,
    fromSeat: outcome.from,
    dealer: outcome.dealer,
  });
}
