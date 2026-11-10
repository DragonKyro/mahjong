// AI benchmark (skipped unless BENCH=1):
//   BENCH=1 npx vitest run src/core/ai/bench.test.ts
//   BENCH=1 V=riichi A=hard B=normal N=80 npx vitest run src/core/ai/bench.test.ts
// (HK is played by networks: benchmark those with training/hk/evaluate.py.)
// Paired seeds: every seed is played twice with the two sides' seats swapped,
// so both get the same tiles — two identical AIs come out exactly even, and
// the result measures play rather than deal luck. Prints points per match
// (side A minus side B), wins and deal-ins.
import { describe, it } from 'vitest';
import { applyAction, createMatch, pendingSeats, type AiLevel } from '../engine';
import { defaultRulesFor, type VariantId } from '../variants';
import { chooseAction } from './index';

const env = (k: string, d: string) => (typeof process !== 'undefined' ? process.env[k] : undefined) ?? d;

function duel(variant: VariantId, a: AiLevel, b: AiLevel, n: number) {
  let A = 0;
  let B = 0;
  const wins = [0, 0];
  const dealIns = [0, 0];
  for (let i = 0; i < 2 * n; i++) {
    const mine = i % 2 ? [0, 2] : [1, 3];
    let s = createMatch({
      variant,
      rules: defaultRulesFor(variant),
      seed: 9000 + Math.floor(i / 2),
      seats: [0, 1, 2, 3].map((k) => ({ name: `P${k}`, ai: true, level: mine.includes(k) ? a : b })),
    });
    const start = s.scores.slice();
    while (!s.over) s = applyAction(s, chooseAction(s, pendingSeats(s)[0]!)!);
    for (const h of s.history)
      for (const w of h.wins) {
        wins[mine.includes(w.seat) ? 0 : 1]!++;
        if (!w.selfDraw && w.from !== null) dealIns[mine.includes(w.from) ? 0 : 1]!++;
      }
    s.scores.forEach((x, k) => (mine.includes(k) ? (A += x - start[k]!) : (B += x - start[k]!)));
  }
  console.log(`${variant} ${a} vs ${b}: ${Math.round((A - B) / (2 * n))} / match · wins ${wins[0]}–${wins[1]} · deal-ins ${dealIns[0]}–${dealIns[1]}`);
}

describe.skipIf(env('BENCH', '') !== '1')('AI benchmark', () => {
  it('levels', { timeout: 3_600_000 }, () => {
    const n = Number(env('N', '30'));
    for (const v of env('V', 'taiwan,riichi,american').split(',') as VariantId[]) duel(v, env('A', 'normal') as AiLevel, env('B', 'easy') as AiLevel, n);
  });
});
