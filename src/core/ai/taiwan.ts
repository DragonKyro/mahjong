// Taiwanese 16-tile AI.
//
// What matters in Taiwan: there's no minimum, so any complete hand wins the
// base (底) — speed counts for more than in Hong Kong. Value comes in linear
// tai on top of the base; the cheap sources it plans for are staying concealed
// (門清 1, and a concealed self-draw 門清自摸 3 from all three players), seat
// flowers, value pongs, and a flush or all-pongs hand when the tiles lean
// that way. With five sets to make, getting closer matters far more than
// keeping many tiles live (see accWeight). On a discard only the discarder
// pays, and payments with the dealer carry the dealer's tai (1 + 2 per 連莊),
// so the hard AI weighs danger from (and to) the dealer more.

import type { Action, Claim } from '../engine';
import { dealerTai, type TaiwanRules } from '../variants/taiwan';
import { isOpen, standardClaim, standardTurn, suitStats, tripletProgress, valuePongs, type Ctx, type Plan, type Shape } from './kit';

function potential(ctx: Ctx, shape: Shape): number {
  const open = isOpen(shape);
  // Self-draw (~1 in 3): 自摸 1 open, 門清自摸 3 instead of 門清 1 when concealed.
  let v = open ? 0.35 : 1 + 0.35 * 2;
  v += ctx.bonus.filter((k) => (k - 34) % 4 === ctx.seatWind).length;
  v += valuePongs(ctx, shape);
  const { other, honors, meldsOk } = suitStats(shape);
  if (meldsOk && other <= 3) v += (other === 0 && honors === 0 ? 8 : 4) * (1 - other / 4) * 0.85;
  v += tripletProgress(ctx, shape) * 4;
  return v;
}

export function taiwanPlan(ctx: Ctx): Plan {
  const rules = ctx.s.config.rules as TaiwanRules;
  return {
    potential,
    minimum: rules.minTai,
    // Linear tai on a base stake and no minimum: a fast cheap win beats a slow
    // dear one, so value is capped low and only tips similar shapes.
    valueCap: 1.5,
    valueWeight: 2.2,
    // Sixteen-tile hands accept so many tiles that weighing acceptance like a
    // 13-tile hand trades real progress for width. Measured (paired seeds vs
    // the shared AI): 0.25 → even, 0.1 → +102 / match, 0.05 → +155, 0 → −12.
    accWeight: 0.05,
    tsumoOnly: 0.3,
    riichi: () => 0,
    deadTenpai: () => -12,
  };
}

export function taiwanTurn(ctx: Ctx): Action {
  const rules = ctx.s.config.rules as TaiwanRules;
  const dealerExtra = dealerTai(ctx.s.streak, rules);
  return standardTurn(ctx, taiwanPlan(ctx), {
    // Feeding the dealer costs the dealer's tai on top (and the dealer, losing, pays them).
    weightOf: (seat) => (seat === ctx.s.dealer || ctx.seat === ctx.s.dealer ? 1 + dealerExtra / 4 : 1),
    defense: (c, { minShanten, best, threat }) => {
      const top = Math.max(...threat);
      return minShanten >= 2 && top >= 0.9 && best.utility < 0 && c.level !== 'easy' ? 6 : 0;
    },
  });
}

export function taiwanClaim(ctx: Ctx, options: Claim[]): Claim {
  // The value plan already charges a call for giving up 門清 / 門清自摸.
  return standardClaim(ctx, taiwanPlan(ctx), options, 0.8);
}
