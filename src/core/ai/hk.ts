// Hong Kong Old Style AI.
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

import type { Action, Claim } from '../engine';
import type { HkRules } from '../variants/hk';
import { isOpen, standardClaim, standardTurn, suitStats, tripletProgress, valuePongs, type Ctx, type Plan, type Shape } from './kit';

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
