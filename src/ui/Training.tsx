// Discard trainer: pick the most efficient discard from a 14-tile hand.

import { judge, type PuzzleLevel } from '@/core/training';
import { WIND_ZH } from '@/core/tiles';
import { useTraining } from '@/store/trainingStore';
import { Tile, TileRow } from './Tile';

const LEVEL_LABEL: Record<PuzzleLevel, string> = { near: 'Close to ready', mid: 'One or two away', far: 'Far from ready' };

function shantenText(n: number): string {
  if (n < 0) return 'complete';
  if (n === 0) return 'ready (聽牌)';
  return `${n} away`;
}

export function Training() {
  const t = useTraining();
  const p = t.puzzle;
  const result = t.guess !== null ? judge(p, t.guess) : null;
  const sorted = [...p.analysis].sort((a, b) => a.shanten - b.shanten || b.acceptance - a.acceptance);
  const rate = t.progress.played ? Math.round((t.progress.best / t.progress.played) * 100) : 0;
  return (
    <div className="training">
      <section className="panel">
        <div className="train-head">
          <div>
            <h2>Discard trainer</h2>
            <p className="muted">
              Which tile keeps your hand closest to winning — the fewest tiles from ready, then the most tiles that help? Seat{' '}
              <span className="cjk">{WIND_ZH[p.seatWind]}</span>, round <span className="cjk">{WIND_ZH[p.prevailing]}</span>.
            </p>
          </div>
          <label className="row">
            Puzzles
            <select value={t.level} onChange={(e) => t.setLevel(e.target.value as PuzzleLevel)}>
              {(Object.keys(LEVEL_LABEL) as PuzzleLevel[]).map((l) => (
                <option key={l} value={l}>
                  {LEVEL_LABEL[l]}
                </option>
              ))}
            </select>
          </label>
        </div>
        <div className="train-hand">
          {p.hand.map((k, i) => {
            const isGuess = t.guess === k;
            const isBest = result && p.best.kind === k;
            return (
              <Tile
                key={i}
                kind={k}
                interactive
                disabled={t.guess !== null}
                className={`${isBest ? 'best' : ''} ${isGuess && !isBest ? 'picked' : ''}`}
                onClick={() => t.answer(k)}
              />
            );
          })}
        </div>
        {result ? (
          <div className={`verdict ${result.verdict}`}>
            <b>{result.verdict === 'best' ? 'Best discard!' : result.verdict === 'good' ? 'Close — nearly as good.' : 'Not the best.'}</b>{' '}
            Discarding <Tile kind={t.guess!} className="inline" /> leaves you {shantenText(result.pick.shanten)} with {result.pick.acceptance} useful tiles.
            {result.verdict !== 'best' && (
              <>
                {' '}
                Best: <Tile kind={p.best.kind} className="inline" /> — {shantenText(p.best.shanten)}, {p.best.acceptance} tiles.
              </>
            )}
            <button type="button" className="btn primary" autoFocus onClick={t.next}>
              Next hand
            </button>
          </div>
        ) : (
          <p className="muted">Click the tile you would discard.</p>
        )}
        <div className="progress">
          <span>
            {t.progress.best}/{t.progress.played} best ({rate}%)
          </span>
          <span>streak {t.progress.streak}</span>
          <span>best streak {t.progress.bestStreak}</span>
          <button type="button" className="btn small ghost" onClick={t.reset}>
            Reset
          </button>
        </div>
      </section>
      {result && (
        <section className="panel">
          <h3>Every discard</h3>
          <table className="analysis">
            <thead>
              <tr>
                <th>Discard</th>
                <th>Leaves you</th>
                <th>Useful tiles</th>
                <th>Which ones</th>
              </tr>
            </thead>
            <tbody>
              {sorted.map((a) => (
                <tr key={a.kind} className={a.kind === p.best.kind ? 'best' : a.kind === t.guess ? 'picked' : ''}>
                  <td>
                    <Tile kind={a.kind} className="inline" />
                  </td>
                  <td>{shantenText(a.shanten)}</td>
                  <td className="num">{a.acceptance}</td>
                  <td>
                    <TileRow kinds={a.accepts.map((x) => x.kind)} className="mini" />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}
    </div>
  );
}

