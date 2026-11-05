// Discard drills: a random 14-tile concealed hand, and the efficiency answer
// (lowest shanten, then the most tiles that improve it). Pure and seeded, so a
// puzzle id reproduces the same hand.

import { analyzeDiscards, bestByEfficiency, shanten, type DiscardInfo } from './hand';
import { Rng } from './rng';
import { countKinds, kindOf, tileIds, type Kind } from './tiles';

export interface Puzzle {
  seed: number;
  hand: Kind[];
  seatWind: number;
  prevailing: number;
  shanten: number;
  analysis: DiscardInfo[];
  best: DiscardInfo;
}

export type PuzzleLevel = 'near' | 'mid' | 'far';
const TARGET: Record<PuzzleLevel, [number, number]> = { near: [0, 1], mid: [1, 2], far: [2, 3] };

/** A puzzle whose best discard leaves the hand within the level's shanten range. */
export function makePuzzle(seed: number, level: PuzzleLevel = 'mid'): Puzzle {
  const rng = new Rng(seed);
  const [lo, hi] = TARGET[level];
  const ids = tileIds({ bonus: 0, jokers: 0 });
  let fallback: Puzzle | null = null;
  for (let attempt = 0; attempt < 400; attempt++) {
    const hand = rng
      .shuffle(ids.slice())
      .slice(0, 14)
      .map(kindOf)
      .sort((a, b) => a - b);
    const counts = countKinds(hand);
    if (shanten(counts, 4) === -1) continue;
    const analysis = analyzeDiscards(counts, 4, counts);
    const best = bestByEfficiency(analysis);
    const p: Puzzle = { seed, hand, seatWind: rng.int(4), prevailing: rng.int(2), shanten: best.shanten, analysis, best };
    // Skip puzzles with several equally good answers: they teach nothing.
    const ties = analysis.filter((a) => a.shanten === best.shanten && a.acceptance === best.acceptance).length;
    if (best.shanten >= lo && best.shanten <= hi && ties === 1) return p;
    fallback ??= p;
  }
  return fallback!;
}

/** How a guess compares to the best answer. */
export function judge(p: Puzzle, kind: Kind): { verdict: 'best' | 'good' | 'worse'; pick: DiscardInfo } {
  const pick = p.analysis.find((a) => a.kind === kind)!;
  if (pick.shanten === p.best.shanten && pick.acceptance === p.best.acceptance) return { verdict: 'best', pick };
  if (pick.shanten === p.best.shanten && pick.acceptance >= p.best.acceptance * 0.85) return { verdict: 'good', pick };
  return { verdict: 'worse', pick };
}
