// Japanese Riichi AI.
//
// What matters in Riichi: a win needs a yaku. A concealed hand always has one
// in reserve (riichi), an open hand needs its own (a value pon, tanyao, a
// flush, toitoi), and dora / red fives only count on top of a yaku. So the
// AI stays concealed by default and calls only for a yaku it can see, values
// dora and keeps red fives. When ready and concealed it declares riichi —
// unless the hand already wins dama with good value (silent and dear), or
// someone else's riichi makes a bad wait not worth the commitment. It reads
// its own furiten (waits it has discarded can't ron).
//
// Riichi hands are expensive, so it plays push / fold: against a riichi (or
// three open melds) it pushes a good ready hand, defends with a decent
// one-away hand, and folds a far-off one onto genbutsu, suji and dead honors.
// It doesn't kong into someone else's riichi (a new kan dora helps them).
// Near the end it values any ready hand for the noten payments.

import { liveLeft, type Action, type Claim } from '../engine';
import { shanten } from '../hand';
import { isOrphan, isSuit, isTerminal, kindOf, type TileId } from '../tiles';
import { isRedFive, type RiichiRules } from '../variants/riichi';
import { isOpen, kongKeepsShape, standardClaim, standardTurn, suitStats, tileOf, tripletProgress, valuePongs, winValue, type Ctx, type Plan, type Shape } from './kit';

function simples(shape: Shape): number {
  // Terminals / honors still in the shape (0 = tanyao-ready).
  let bad = 0;
  shape.counts.forEach((n, k) => {
    if (n > 0 && isOrphan(k)) bad += n;
  });
  for (const m of shape.melds) {
    if (!isSuit(m.kind)) bad += 3;
    else if (m.type === 'chi' ? m.kind % 9 === 0 || m.kind % 9 === 6 : isTerminal(m.kind)) bad += 3;
  }
  return bad;
}

const aka = (ctx: Ctx) => (ctx.s.config.rules as RiichiRules).akaDora;
const redCount = (ctx: Ctx) => (aka(ctx) ? ctx.s.hand.players[ctx.seat]!.hand.filter(isRedFive).length : 0);

function potential(ctx: Ctx, shape: Shape): number {
  const open = isOpen(shape);
  const rules = ctx.s.config.rules as RiichiRules;
  let yaku = 0;
  if (!open) yaku += 1 + 0.35 + 0.25; // riichi, menzen tsumo, ura chances
  yaku += Math.min(valuePongs(ctx, shape), 2.5);
  const bad = simples(shape);
  if (!open || rules.kuitan) yaku += bad === 0 ? 1 : bad <= 2 ? 0.45 : 0;
  const { other, honors, meldsOk } = suitStats(shape);
  if (meldsOk && other <= 3) yaku += (other === 0 && honors === 0 ? (open ? 5 : 6) : open ? 2 : 3) * (1 - other / 4) * 0.85;
  yaku += tripletProgress(ctx, shape) * 2;
  // Dora and red fives only count once there's a yaku.
  if (yaku < 0.9) return yaku;
  const dora = ctx.dora.reduce((n, d) => n + shape.counts[d]! + shape.melds.filter((m) => m.kind === d || (m.type === 'chi' && d >= m.kind && d <= m.kind + 2)).length, 0);
  return yaku + dora + redCount(ctx);
}

export function riichiPlan(_ctx: Ctx): Plan {
  return {
    potential,
    minimum: 1,
    // Points roughly double per han up to mangan (5); beyond it they flatten.
    valueCap: 6,
    valueWeight: 1.8,
    // Measured: 0.25 → +7,000 / match over the shared AI, 0.15 → +10,500.
    accWeight: 0.15,
    tsumoOnly: 0.35,
    // A concealed ready hand can declare riichi, so value it as one.
    riichi: (c, shape) => (c.s.hand.riichi[c.seat] || !isOpen(shape) ? 1 : 0),
    // Late on, any ready hand is worth having for the noten payments.
    deadTenpai: (c) => (liveLeft(c.s) <= 10 ? -1 : -12),
  };
}

const riichiDeclared = (ctx: Ctx) => ctx.s.hand.riichi.some((r, i) => r && i !== ctx.seat);

export function riichiTurn(ctx: Ctx): Action {
  const { s, seat } = ctx;
  const plan = riichiPlan(ctx);
  // 九種九牌: abort unless thirteen orphans looks close.
  const shape0 = (() => {
    const c = new Array<number>(34).fill(0);
    for (const t of s.hand.players[seat]!.hand) c[kindOf(t)]!++;
    return c;
  })();
  const orphanKinds = shape0.filter((n, k) => n > 0 && isOrphan(k)).length;
  if (s.hand.played[seat] === 0 && s.hand.calls === 0 && orphanKinds >= 9 && orphanKinds < 11 && (s.hand.drawKind === 'deal' || s.hand.drawKind === 'wall')) {
    return { type: 'abort', seat };
  }
  return standardTurn(ctx, plan, {
    // Not ready against someone's riichi: a new kan dora would only help them.
    kong: (c, shape, k) => (riichiDeclared(c) && shanten(shape.counts, 4 - shape.melds.length, c.shape) > 0 ? false : c.level === 'easy' || kongKeepsShape(c, shape, k)),
    // Discarding a red five costs a han.
    bonus: (c, cand) => {
      if (!aka(c)) return 0;
      const tiles = c.s.hand.players[c.seat]!.hand.filter((t) => kindOf(t) === cand.kind);
      return tiles.length > 0 && tiles.every(isRedFive) ? -2 : 0;
    },
    defense: (c, { minShanten, best, threat }) => {
      const top = Math.max(...threat);
      if (top < 0.9) return 0;
      const scale = 0.7;
      if (minShanten === 0) return (best.winAcc >= 4 || best.value >= 3 ? 0.4 : 3) * scale;
      if (minShanten === 1) return (best.utility > 0 && liveLeft(c.s) > 25 ? 4 : 9) * scale;
      return 14 * scale;
    },
    finish: (c, shape, chosen, all, opts, weight) => {
      const isRed = (t: TileId) => aka(c) && isRedFive(t);
      const plain = { type: 'discard' as const, seat, tile: tileOf(c, chosen.kind, isRed) };
      if (opts.riichi.length === 0 || c.level === 'easy') {
        return opts.riichi.length > 0 && opts.riichi.some((t) => kindOf(t) === chosen.kind)
          ? { ...plain, tile: opts.riichi.find((t) => kindOf(t) === chosen.kind)!, riichi: true }
          : plain;
      }
      // The best riichi-able discard, by utility under the turn's defence weight.
      const ready = all.filter((x) => x.e.shanten === 0 && opts.riichi.some((t) => kindOf(t) === x.kind));
      if (ready.length === 0) return plain;
      const pick = ready.reduce((a, b) => (b.e.utility - weight * b.danger > a.e.utility - weight * a.danger ? b : a));
      // Would it win dama (no riichi), and for how much?
      shape.counts[pick.kind]!--;
      const damaWins = waitsValue(c, shape);
      shape.counts[pick.kind]!++;
      const someoneElse = riichiDeclared(c);
      let declare: boolean;
      if (damaWins === null) declare = !(someoneElse && pick.e.winAcc < 3 && c.level === 'hard');
      else declare = damaWins < 4 && pick.e.winAcc >= 3 && !(someoneElse && pick.e.winAcc < 4);
      if (!declare) {
        // Dama: still throw the ready-making tile if it's the best plain discard too.
        return pick.kind === chosen.kind ? plain : chosen.e.shanten === 0 ? plain : { ...plain, tile: tileOf(c, pick.kind, isRed) };
      }
      return { type: 'discard', seat, tile: opts.riichi.find((t) => kindOf(t) === pick.kind && !isRed(t)) ?? opts.riichi.find((t) => kindOf(t) === pick.kind)!, riichi: true };
    },
  });
}

/** For a ready concealed shape: the best value a ron would bring without riichi, or null when none wins dama. */
function waitsValue(ctx: Ctx, shape: Shape): number | null {
  let best: number | null = null;
  for (let w = 0; w < 34; w++) {
    if (shape.counts[w]! >= 4) continue;
    const v = winValue(ctx, shape, w, false, 0);
    if (v !== null && (best === null || v > best)) best = v;
  }
  return best;
}

export function riichiClaim(ctx: Ctx, options: Claim[]): Claim {
  const plan = riichiPlan(ctx);
  const concealed = !ctx.s.hand.players[ctx.seat]!.melds.some((m) => !m.concealed);
  const endgame = liveLeft(ctx.s) <= 6;
  const threatened = riichiDeclared(ctx);
  return standardClaim(ctx, plan, options, concealed ? 3 : 0.6, (claim, r) => {
    if (claim.type === 'win') return true;
    // Late: any call that makes the hand ready is worth it (noten payments).
    if (endgame && r.e.shanten === 0) return true;
    // A call has to leave a yaku to aim for, and shouldn't walk into a riichi unready.
    if (potential(ctx, r.after) < 0.9) return false;
    if (threatened && r.e.shanten > 0) return false;
    return true;
  });
}
