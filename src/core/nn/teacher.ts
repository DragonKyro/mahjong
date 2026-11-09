// The heuristic Hong Kong Old Style player — no longer the game's computer
// player (HK is played by the trained networks, see src/core/ai/neural.ts), but
// still used as:
//   - the imitation teacher for the first updates of a training run,
//   - the benchmark opponent ("vs heuristic" in training reports),
//   - a cheap, deterministic driver for tests that need whole HK matches.
// It is not imported by the app, so it isn't bundled into the game.
//
// What matters in HK: every win needs the faan minimum (3 by default), and
// most hands only just reach it — 門前清, 自摸, 無花 / seat flowers, a value
// pong, 平糊. So the AI plans for faan from the start: it keeps concealed
// when that's its route, values dragon / seat / round wind pairs, drifts
// toward one suit when the hand leans that way, and treats a ready hand that
// can't reach the minimum as no better than one tile away. Payouts double
// with faan but a discard win costs the discarder only half (半銃), so
// dealing in is cheap: defence only kicks in for a far-off hand against
// someone showing three melds (measured: broader folding lost points).

import type { AiLevel } from '../engine';
import { claimOptions, type Action, type Claim, type MatchState } from '../engine';
import { isOpen, makeCtx, standardClaim, standardTurn, suitStats, tripletProgress, valuePongs, type Ctx, type Plan, type Shape } from '../ai/kit';
import { registerNeural, type NeuralPlayer } from '../ai/neural';
import { kindOf } from '../tiles';
import type { HkRules } from '../variants/hk';

function potential(ctx: Ctx, shape: Shape): number {
  const { counts, melds } = shape;
  let v = 0.35; // self-draw chance
  if (!isOpen(shape)) v += 1; // 門前清
  if (ctx.bonus.length === 0) v += 1; // 無花
  else v += ctx.bonus.filter((k) => (k - 34) % 4 === ctx.seatWind).length; // 正花
  v += valuePongs(ctx, shape);
  const { other, honors, meldsOk } = suitStats(shape);
  if (meldsOk && other <= 3) v += (other === 0 && honors === 0 ? 7 : 3) * (1 - other / 4) * 0.85;
  v += tripletProgress(ctx, shape) * 3;
  // 平糊: chows only, few honors.
  if (melds.every((m) => m.type === 'chi') && honors <= 2 && !counts.some((n) => n >= 3)) v += 0.6;
  return v;
}

export function hkPlan(ctx: Ctx): Plan {
  const rules = ctx.s.config.rules as HkRules;
  return {
    potential,
    minimum: rules.minFaan,
    valueCap: rules.minFaan + 1.5,
    valueWeight: 2.2,
    // Measured (paired seeds vs the shared AI): 0.25 → even, 0.1 → +17 points and
    // ~60% of the wins between them, fewer deal-ins.
    accWeight: 0.1,
    tsumoOnly: 0.3,
    riichi: () => 0,
    deadTenpai: () => -12,
  };
}

export function hkTurn(ctx: Ctx): Action {
  return standardTurn(ctx, hkPlan(ctx), {
    defense: (c, { minShanten, best, threat }) => {
      // Broad folding loses points here (measured), for normal and hard alike:
      // only a hopeless hand against three melds gives way.
      const top = Math.max(...threat);
      return minShanten >= 2 && top >= 0.9 && best.utility < 0 && c.level !== 'easy' ? 6 : 0;
    },
  });
}

export function hkClaim(ctx: Ctx, options: Claim[]): Claim {
  return standardClaim(ctx, hkPlan(ctx), options, 0.8);
}

/** The answer to whatever the engine is waiting on from `seat` (the seat's `level` picks easy / normal / hard), or null. */
export function teacherAction(s: MatchState, seat: number): Action | null {
  const h = s.hand;
  if (s.over) return null;
  if (h.phase === 'end') return h.ready[seat] ? null : { type: 'ready', seat };
  if (h.phase === 'claim') {
    const options = claimOptions(s, seat);
    return options.length === 0 ? null : { type: 'claim', seat, claim: hkClaim(makeCtx(s, seat), options) };
  }
  if (h.phase === 'act' && h.turn === seat) return hkTurn(makeCtx(s, seat));
  return null;
}

export const teacherPlayer: NeuralPlayer = {
  meta: { teacher: true },
  act: teacherAction,
  hint(s, seat) {
    if (s.hand.phase !== 'act' || s.hand.turn !== seat) return null;
    const a = hkTurn(makeCtx(s, seat));
    return a.type === 'discard' ? kindOf(a.tile) : null;
  },
};

/** Play every HK computer seat with the heuristic (tests and tools; the game loads networks instead). */
export function useTeacherForHk(): void {
  for (const level of ['easy', 'normal', 'hard'] as AiLevel[]) registerNeural('hk', level, teacherPlayer);
}
