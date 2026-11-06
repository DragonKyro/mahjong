// American AI: a card planner.
//
// What matters in American: only hands on the card win, so the AI measures
// how many tiles it is from each card hand (`distance`, jokers filling
// groups of three or more) and plays toward the nearest few. In the
// Charleston it passes what none of those hands want (jokers never), and it
// votes for a second Charleston only when it's still far off. It exposes a
// called tile only when that gets it strictly closer (an exposure commits
// the hand), buys back jokers when that costs it nothing, and declares Mah
// Jongg whenever it can.
//
// Defence: an opponent's exposures are public, and only card hands that fit
// them are still possible for that player — so the AI works out which tiles
// those hands still need and avoids feeding a player close to Mah Jongg
// (several exposures), more so the further its own hand is from done.

import { charlestonAsk, liveLeft, turnOptions, type Action, type Claim } from '../engine';
import { JOKER, kindOf, type TileId } from '../tiles';
import { FORMS, cardKind, closest, exposuresFit, holdingOf, type Holding } from '../variants/american';
import type { Ctx } from './kit';

/** Any joker id stands for "a joker" in a holding. */
const ANY_JOKER: TileId = 144;

function holding(ctx: Ctx, extra: TileId[] = [], remove: TileId[] = []): Holding {
  const p = ctx.s.hand.players[ctx.seat]!;
  const drop = new Set(remove);
  return holdingOf([...p.hand.filter((t) => !drop.has(t)), ...extra], p.melds);
}

const bestDistance = (h: Holding) => closest(h, 1)[0]?.distance ?? 99;

/** How much each card kind is wanted by the nearest hands. */
function usefulness(h: Holding): number[] {
  const want = new Array<number>(35).fill(0);
  for (const { form, distance } of closest(h, 8)) {
    const w = 1 / (1 + distance);
    form.need.forEach((n, k) => {
      if (n > 0) want[k]! += w * Math.min(1, n / Math.max(1, h.counts[k]!));
    });
  }
  return want;
}

/** Per card kind: how likely discarding it feeds an exposed opponent. */
function dangerByKind(ctx: Ctx): number[] {
  const danger = new Array<number>(35).fill(0);
  const late = liveLeft(ctx.s) < 30 ? 0.2 : 0;
  ctx.s.hand.players.forEach((p, o) => {
    if (o === ctx.seat || p.melds.length === 0) return;
    const exposures = holdingOf([], p.melds).exposures;
    const fits = FORMS.filter((f) => exposuresFit(f, exposures));
    if (fits.length === 0) return;
    const threat = Math.min(1, (p.melds.length >= 3 ? 1 : p.melds.length === 2 ? 0.6 : 0.3) + late);
    const shown = holdingOf([], p.melds).counts;
    const needs = new Array<number>(35).fill(0);
    for (const f of fits) f.need.forEach((n, k) => n > shown[k]! && (needs[k]! += 1));
    needs.forEach((n, k) => (danger[k]! += threat * (n / fits.length)));
  });
  return danger;
}

export function americanTurn(ctx: Ctx): Action {
  const { s, seat } = ctx;
  const opts = turnOptions(s, seat);
  if (opts.win) return { type: 'win', seat };
  const p = s.hand.players[seat]!;
  const now = holding(ctx);
  const nowDist = bestDistance(now);
  for (const swap of opts.swaps) {
    if (bestDistance(holding(ctx, [ANY_JOKER], [swap.tile])) <= nowDist) return { type: 'swap', seat, tile: swap.tile, target: swap.target };
  }
  const want = usefulness(now);
  const danger = ctx.level === 'easy' ? null : dangerByKind(ctx);
  const dangerWeight = !danger ? 0 : 0.8 * (nowDist >= 3 ? 2 : nowDist >= 1 ? 1 : 0.3);
  const pool = p.hand.filter((t) => kindOf(t) !== JOKER);
  const options = pool.length > 0 ? pool : p.hand;
  const ranked = options
    .map((t) => {
      const k = cardKind(t);
      const d = bestDistance(holding(ctx, [], [t]));
      return { t, d, score: d * 3 + (want[k] ?? 0) + dangerWeight * (danger?.[k] ?? 0) };
    })
    .sort((a, b) => a.score - b.score);
  const pick = ctx.level === 'easy' ? ranked[Math.min(ranked.length - 1, ctx.rng.int(3))]! : ranked[0]!;
  return { type: 'discard', seat, tile: pick.t };
}

export function americanClaim(ctx: Ctx, options: Claim[]): Claim {
  if (options.some((o) => o.type === 'win')) return { type: 'win' };
  const c = ctx.s.hand.claim!;
  const nowDist = bestDistance(holding(ctx));
  let best: Claim = { type: 'pass' };
  // Call when the exposure gets the hand strictly closer (easy: at least as close).
  let bestDist = nowDist + (ctx.level === 'easy' ? 1 : 0);
  const p = ctx.s.hand.players[ctx.seat]!;
  for (const o of options) {
    if (o.type !== 'expose') continue;
    // Expose, then discard the least useful tile.
    const k = cardKind(c.tile);
    const naturals = p.hand.filter((t) => cardKind(t) === k).slice(0, o.size - 1 - o.jokers);
    const jokers = p.hand.filter((t) => kindOf(t) === JOKER).slice(0, o.jokers);
    const used = new Set([...naturals, ...jokers]);
    const rest = p.hand.filter((t) => !used.has(t));
    const melds = [...p.melds, { tiles: [...naturals, c.tile, ...jokers], kind: kindOf(c.tile) }];
    let d = Infinity;
    for (const t of rest) {
      if (kindOf(t) === JOKER) continue;
      d = Math.min(d, bestDistance(holdingOf(rest.filter((x) => x !== t), melds)));
    }
    if (d < bestDist) {
      bestDist = d;
      best = o;
    }
  }
  return best;
}

export function americanCharleston(ctx: Ctx): Action | null {
  const ask = charlestonAsk(ctx.s, ctx.seat);
  if (!ask) return null;
  const h = holding(ctx);
  if (ask.kind === 'vote') return { type: 'vote', seat: ctx.seat, yes: bestDistance(h) >= 4 };
  const want = usefulness(h);
  const p = ctx.s.hand.players[ctx.seat]!;
  const ranked = p.hand
    .filter((t) => kindOf(t) !== JOKER)
    .map((t) => ({ t, w: want[cardKind(t)]! + (ctx.level === 'easy' ? ctx.rng.next() * 0.3 : 0) }))
    .sort((a, b) => a.w - b.w);
  if (ask.min === 0) {
    const junk = ranked.filter((x) => x.w < 0.05).slice(0, ask.max);
    return { type: 'pass', seat: ctx.seat, tiles: junk.map((x) => x.t) };
  }
  return { type: 'pass', seat: ctx.seat, tiles: ranked.slice(0, ask.min).map((x) => x.t) };
}

/** The nearest hands on the card for `seat` (the card panel). */
export function nearestFor(ctx: Ctx, limit: number) {
  const p = ctx.s.hand.players[ctx.seat]!;
  return closest(holdingOf(p.hand, p.melds), limit);
}
