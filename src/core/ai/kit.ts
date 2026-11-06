// The toolkit every variant AI is built from: reading a seat's hand, valuing
// a shape (speed vs. value, through the variant's own Plan), estimating
// danger, and the generic turn / claim routines the variant AIs plug their
// rules into. Nothing here knows a specific variant.

import {
  blankWinInput,
  indicatorIds,
  liveLeft,
  meldFacts,
  seatWind,
  turnOptions,
  variantOf,
  visibleCounts,
  type Action,
  type AiLevel,
  type Claim,
  type MatchState,
  type TurnOptions,
} from '../engine';
import { shanten, waits, type ShapeOptions } from '../hand';
import { Rng } from '../rng';
import { isHonor, isSuit, kindOf, suitOf, windKind, type Kind, type TileId } from '../tiles';
import { doraFromIndicator, type MeldFact, type PlayableVariant, type WinInput } from '../variants';

export interface Ctx {
  s: MatchState;
  seat: number;
  level: AiLevel;
  variant: PlayableVariant;
  shape: ShapeOptions;
  visible: number[];
  bonus: Kind[];
  seatWind: number;
  dora: Kind[];
  rng: Rng;
}

export interface Shape {
  counts: number[];
  melds: MeldFact[];
}

export function makeCtx(s: MatchState, seat: number): Ctx {
  const variant = variantOf(s);
  const p = s.hand.players[seat]!;
  return {
    s,
    seat,
    level: s.config.seats[seat]?.level ?? 'normal',
    variant,
    shape: variant.shape(s.config.rules),
    visible: visibleCounts(s, seat),
    bonus: p.bonus.map(kindOf),
    seatWind: seatWind(s, seat),
    dora: indicatorIds(s).dora.map((t) => doraFromIndicator(kindOf(t))),
    // Deterministic per decision: same state → same choice.
    rng: new Rng((s.rng ^ Math.imul(s.seq + 1, 2654435761) ^ (seat * 97)) >>> 0),
  };
}

export function shapeOf(s: MatchState, seat: number): Shape {
  const p = s.hand.players[seat]!;
  const counts = new Array<number>(34).fill(0);
  for (const t of p.hand) {
    const k = kindOf(t);
    if (k < 34) counts[k]!++;
  }
  return { counts, melds: meldFacts(p) };
}

export const setsLeft = (ctx: Ctx, shape: Shape) => (ctx.variant.handSize - 1) / 3 - shape.melds.length;
export const isOpen = (shape: Shape) => shape.melds.some((m) => !m.concealed);
export const rulesOf = (ctx: Ctx) => ctx.s.config.rules;
export const outer = (k: Kind) => (k >= 27 ? 10 : Math.max(k % 9, 8 - (k % 9)));
export const valueKinds = (ctx: Ctx): Kind[] => [31, 32, 33, windKind(ctx.seatWind), windKind(ctx.s.prevailing)];

export function winInput(ctx: Ctx, shape: Shape, win: Kind, selfDraw: boolean, riichi: 0 | 1 = 0): WinInput {
  const concealed: Kind[] = [];
  shape.counts.forEach((n, k) => {
    for (let i = 0; i < n; i++) concealed.push(k);
  });
  concealed.push(win);
  return blankWinInput({
    seat: ctx.seat,
    seatWind: ctx.seatWind,
    prevailing: ctx.s.prevailing,
    dealer: ctx.s.dealer,
    concealed,
    winTile: win,
    melds: shape.melds,
    bonus: ctx.bonus,
    selfDraw,
    from: selfDraw ? null : (ctx.seat + 3) % 4,
    riichi,
    dora: ctx.dora,
    streak: ctx.s.streak,
  });
}

/** What winning on `win` would be worth (the variant's units), or null when it couldn't win. */
export function winValue(ctx: Ctx, shape: Shape, win: Kind, selfDraw: boolean, riichi: 0 | 1 = 0): number | null {
  const rules = rulesOf(ctx);
  const score = ctx.variant.evaluate(winInput(ctx, shape, win, selfDraw, riichi), rules);
  return score && ctx.variant.canWin(score, rules) ? score.value : null;
}

/** The dominant suit, how many tiles fall outside it, honors, and whether the melds fit it. */
export function suitStats(shape: Shape): { dom: number; other: number; honors: number; meldsOk: boolean } {
  const suit = [0, 0, 0];
  let honors = 0;
  shape.counts.forEach((n, k) => {
    if (isSuit(k)) suit[suitOf(k)]! += n;
    else if (isHonor(k)) honors += n;
  });
  for (const m of shape.melds) {
    if (isSuit(m.kind)) suit[suitOf(m.kind)]! += 3;
    else honors += 3;
  }
  const dom = suit.indexOf(Math.max(...suit));
  const other = suit.reduce((a, n, i) => a + (i === dom ? 0 : n), 0);
  const meldsOk = shape.melds.every((m) => !isSuit(m.kind) || suitOf(m.kind) === dom);
  return { dom, other, honors, meldsOk };
}

/** Pongs (made or held) of the seat's value honors, pairs counted at 0.45. */
export function valuePongs(ctx: Ctx, shape: Shape): number {
  let n = 0;
  for (const k of valueKinds(ctx)) {
    if (shape.melds.some((m) => m.type !== 'chi' && m.kind === k) || shape.counts[k]! >= 3) n += 1;
    else if (shape.counts[k] === 2) n += 0.45;
  }
  return n;
}

/** 0–1: how far along an all-pongs hand is. */
export function tripletProgress(ctx: Ctx, shape: Shape): number {
  if (!shape.melds.every((m) => m.type !== 'chi')) return 0;
  let tp = shape.melds.length;
  shape.counts.forEach((n) => {
    if (n >= 2) tp++;
  });
  const need = setsLeft(ctx, shape) + shape.melds.length;
  return tp >= need + 1 ? 0.8 : tp >= need ? 0.37 : 0;
}

/** A variant AI's planning model: what its hands are worth and how it trades speed for value. */
export interface Plan {
  /** Value (in the variant's units) a not-yet-ready shape is heading for. */
  potential(ctx: Ctx, shape: Shape): number;
  /** Value needed to win at all; a shape below it is penalised. */
  minimum: number;
  /** Value beyond this adds nothing. */
  valueCap: number;
  /** Utility per unit of value (one shanten step is worth 12). */
  valueWeight: number;
  /** Utility per tile that improves the hand. */
  accWeight: number;
  /** A wait that can only win by self-draw counts this much of one that wins off a discard. */
  tsumoOnly: number;
  /** Value a concealed hand as if it will declare riichi. */
  riichi(ctx: Ctx, shape: Shape): 0 | 1;
  /** Utility of a ready hand that can't legally win. */
  deadTenpai(ctx: Ctx): number;
}

export interface Eval {
  utility: number;
  shanten: number;
  acceptance: number;
  /** Ready hands: unseen tiles that win (self-draw-only ones discounted). */
  winAcc: number;
  /** Ready hands: average value of a win. */
  value: number;
}

/** How good a hand waiting for its next tile is, under `plan`. */
export function evaluate(ctx: Ctx, shape: Shape, plan: Plan): Eval {
  const sets = setsLeft(ctx, shape);
  const sh = shanten(shape.counts, sets, ctx.shape);
  const c = shape.counts;
  let acceptance = 0;
  for (let d = 0; d < 34; d++) {
    const left = 4 - ctx.visible[d]!;
    if (left <= 0) continue;
    c[d]!++;
    if (shanten(c, sets, ctx.shape) < sh) acceptance += left;
    c[d]!--;
  }
  if (ctx.level === 'easy') return { utility: -sh * 12 + acceptance * 0.3, shanten: sh, acceptance, winAcc: 0, value: 0 };

  const valueTerm = (v: number) => plan.valueWeight * Math.min(v, plan.valueCap) - (v < plan.minimum ? (plan.minimum - v) * 2.5 : 0);
  if (sh === 0) {
    const riichi = plan.riichi(ctx, shape);
    const ws = waits(c, sets, ctx.shape);
    // Riichi furiten: a wait among your own discards blocks every ron.
    const gone = new Set(ctx.s.hand.players[ctx.seat]!.gone.map(kindOf));
    const furiten = ctx.variant.features.riichi && ws.some((w) => gone.has(w));
    let winAcc = 0;
    let valueSum = 0;
    let n = 0;
    for (const w of ws) {
      const left = 4 - ctx.visible[w]!;
      if (left <= 0) continue;
      const ron = furiten ? null : winValue(ctx, shape, w, false, riichi);
      const tsumo = winValue(ctx, shape, w, true, riichi);
      if (ron !== null) winAcc += left;
      else if (tsumo !== null) winAcc += left * plan.tsumoOnly;
      const v = ron ?? tsumo;
      if (v !== null) {
        valueSum += v * left;
        n += left;
      }
    }
    if (winAcc > 0) {
      const value = valueSum / n;
      return { utility: 6 + winAcc * 0.8 + valueTerm(value), shanten: 0, acceptance, winAcc, value };
    }
    return { utility: plan.deadTenpai(ctx) + acceptance * 0.15 + valueTerm(plan.potential(ctx, shape)), shanten: 0, acceptance, winAcc: 0, value: 0 };
  }
  return { utility: -sh * 12 + acceptance * plan.accWeight + valueTerm(plan.potential(ctx, shape)), shanten: sh, acceptance, winAcc: 0, value: 0 };
}

// ------------------------------------------------------------ defence

/** 0–1 per seat: how likely that opponent is to be ready. */
export function threats(ctx: Ctx): number[] {
  const left = liveLeft(ctx.s);
  return ctx.s.hand.players.map((p, i) => {
    if (i === ctx.seat) return 0;
    if (ctx.s.hand.riichi[i]) return 1;
    const open = p.melds.length;
    const byTime = Math.min(0.75, Math.max(0, (p.discards.length - 5) / 10));
    const byMelds = open >= 3 ? 0.95 : open === 2 ? 0.55 : open === 1 ? 0.3 : 0;
    let t = Math.max(byTime, byMelds);
    if (left < 20) t += 0.15;
    return Math.min(1, t);
  });
}

/** How likely discarding `k` deals in, weighted by each opponent's threat. */
export function danger(ctx: Ctx, k: Kind, threat: readonly number[], weightOf: (seat: number) => number = () => 1): number {
  let total = 0;
  ctx.s.hand.players.forEach((p, o) => {
    if (threat[o] === 0) return;
    const discards = p.gone.map(kindOf);
    let d: number;
    if (discards.includes(k)) d = 0; // genbutsu
    else if (isHonor(k)) {
      const seen = ctx.visible[k]!;
      d = seen >= 3 ? 0 : seen === 2 ? 0.3 : seen === 1 ? 0.8 : 1.2;
    } else {
      const r = k % 9;
      const suji = (r >= 3 && discards.includes(k - 3)) || (r <= 5 && discards.includes(k + 3));
      d = suji ? 0.5 : r === 0 || r === 8 ? 0.7 : r === 1 || r === 7 ? 0.9 : 1.2;
      // Melds all in one suit: that suit is hot, the others cold.
      const suits = new Set(p.melds.filter((m) => isSuit(m.kind)).map((m) => suitOf(m.kind)));
      if (p.melds.length >= 2 && suits.size === 1) d *= suits.has(suitOf(k)) ? 1.5 : 0.3;
    }
    total += threat[o]! * d * weightOf(o);
  });
  return total;
}

// ------------------------------------------------------------ shared decisions

/** Does declaring a kong on `k` keep the hand at least as close to winning as the best discard? */
export function kongKeepsShape(ctx: Ctx, shape: Shape, k: Kind): boolean {
  const sets = setsLeft(ctx, shape);
  const c = shape.counts;
  let before = 99;
  for (let d = 0; d < 34; d++) {
    if (c[d] === 0) continue;
    c[d]!--;
    before = Math.min(before, shanten(c, sets, ctx.shape));
    c[d]!++;
  }
  const concealedKong = c[k] === 4;
  const after = c.slice();
  after[k] = concealedKong ? 0 : c[k]! - 1;
  return shanten(after, concealedKong ? sets - 1 : sets, ctx.shape) <= before;
}

export function afterClaim(shape: Shape, claim: Claim, k: Kind, from: number): Shape {
  const counts = shape.counts.slice();
  let meld: MeldFact;
  const order = shape.melds.length;
  if (claim.type === 'chi') {
    for (const x of [claim.low, claim.low + 1, claim.low + 2]) if (x !== k) counts[x]!--;
    meld = { type: 'chi', kind: claim.low, concealed: false, from, order, tiles: [] };
  } else {
    counts[k]! -= claim.type === 'kong' ? 3 : 2;
    meld = { type: claim.type === 'kong' ? 'kong' : 'pong', kind: k, concealed: false, from, order, tiles: [] };
  }
  return { counts, melds: [...shape.melds, meld] };
}

/** The best utility after making `claim` (and, for a chow / pong, the best discard after it). */
export function claimUtility(ctx: Ctx, shape: Shape, claim: Claim, k: Kind, from: number, plan: Plan): { utility: number; after: Shape; e: Eval } {
  const after = afterClaim(shape, claim, k, from);
  if (claim.type === 'kong') {
    const e = evaluate(ctx, after, plan);
    return { utility: e.utility + 1.5, after, e }; // plus a free replacement draw
  }
  let best: { utility: number; e: Eval } | null = null;
  for (let d = 0; d < 34; d++) {
    // Kuikae aside, throwing back the called tile is pointless.
    if (after.counts[d] === 0 || d === k) continue;
    after.counts[d]!--;
    const e = evaluate(ctx, after, plan);
    after.counts[d]!++;
    if (!best || e.utility > best.utility) best = { utility: e.utility, e };
  }
  return { utility: best?.utility ?? -Infinity, after, e: best?.e ?? evaluate(ctx, after, plan) };
}

export interface Candidate {
  kind: Kind;
  e: Eval;
  danger: number;
}

/** Every distinct discard (within `allowed`) with its evaluation and danger. */
export function discardCandidates(ctx: Ctx, shape: Shape, plan: Plan, allowed: ReadonlySet<Kind> | null, threat: readonly number[], weightOf?: (seat: number) => number): Candidate[] {
  const out: Candidate[] = [];
  const defend = threat.some((t) => t > 0);
  for (let k = 0; k < 34; k++) {
    if (shape.counts[k] === 0 || (allowed && !allowed.has(k))) continue;
    shape.counts[k]!--;
    out.push({ kind: k, e: evaluate(ctx, shape, plan), danger: defend ? danger(ctx, k, threat, weightOf) : 0 });
    shape.counts[k]!++;
  }
  return out;
}

/** A tile id of kind `k` to throw: not the drawn tile if there's a choice, and not a red five if avoidable. */
export function tileOf(ctx: Ctx, k: Kind, isPrecious: (t: TileId) => boolean = () => false): TileId {
  const p = ctx.s.hand.players[ctx.seat]!;
  const tiles = p.hand.filter((t) => kindOf(t) === k);
  return tiles.find((t) => !isPrecious(t) && t !== ctx.s.hand.drawn) ?? tiles.find((t) => !isPrecious(t)) ?? tiles[0]!;
}

/**
 * Hard AI lookahead for a one-away hand: over the draws that make it ready,
 * how many winning tiles the best resulting ready hand waits on, weighted by
 * how many of each draw are left. Prefers discards that lead to good waits.
 */
export function readyQuality(ctx: Ctx, shape: Shape): number {
  const sets = setsLeft(ctx, shape);
  const c = shape.counts;
  let total = 0;
  for (let d = 0; d < 34; d++) {
    const left = 4 - ctx.visible[d]!;
    if (left <= 0) continue;
    c[d]!++;
    if (shanten(c, sets, ctx.shape) <= 0) {
      let best = 0;
      for (let x = 0; x < 34; x++) {
        if (c[x] === 0) continue;
        c[x]!--;
        if (shanten(c, sets, ctx.shape) === 0) {
          const n = waits(c, sets, ctx.shape).reduce((a, w) => a + Math.max(0, 4 - ctx.visible[w]! - (w === d ? 1 : 0)), 0);
          if (n > best) best = n;
        }
        c[x]!++;
      }
      total += left * best;
    }
    c[d]!--;
  }
  return total;
}

export interface TurnHooks {
  /** Utility weight on danger for this turn (0 = ignore it). */
  defense(ctx: Ctx, info: { minShanten: number; best: Eval; threat: number[] }): number;
  /** Declare a kong on `k`? (Default: when it keeps the shape.) */
  kong?(ctx: Ctx, shape: Shape, k: Kind): boolean;
  /** Seat weights for danger (e.g. the dealer is costlier to deal into). */
  weightOf?(seat: number): number;
  /** Extra utility per candidate (e.g. keep red fives). */
  bonus?(ctx: Ctx, c: Candidate): number;
  /** Last word on the action, e.g. turning the discard into a riichi declaration. */
  finish?(ctx: Ctx, shape: Shape, chosen: Candidate, all: Candidate[], opts: TurnOptions, weight: number): Action;
}

/** The shared turn routine: win, kong, then the best discard under `plan` and the variant's hooks. */
/** Utility per (draw × winning tile) of the hard AI's lookahead. */
const LOOKAHEAD = 0.04;

export function standardTurn(ctx: Ctx, plan: Plan, hooks: TurnHooks): Action {
  const { s, seat } = ctx;
  const opts = turnOptions(s, seat);
  if (opts.win) return { type: 'win', seat };
  const shape = shapeOf(s, seat);
  for (const k of opts.kongs) {
    const ok = hooks.kong ? hooks.kong(ctx, shape, k) : ctx.level === 'easy' || kongKeepsShape(ctx, shape, k);
    if (ok) return { type: 'kong', seat, kind: k };
  }
  if (opts.allowed && opts.allowed.length === 1) return { type: 'discard', seat, tile: opts.allowed[0]! };
  const allowed = opts.allowed ? new Set(opts.allowed.map(kindOf)) : null;
  const threat = ctx.level === 'easy' ? [0, 0, 0, 0] : threats(ctx);
  const all = discardCandidates(ctx, shape, plan, allowed, threat, hooks.weightOf);
  if (ctx.level === 'easy') {
    const minSh = Math.min(...all.map((c) => c.e.shanten));
    const pool = all.filter((c) => c.e.shanten === minSh).sort((a, b) => b.e.utility - a.e.utility);
    const pick = pool[Math.min(pool.length - 1, ctx.rng.int(Math.min(3, pool.length)))]!;
    return hooks.finish ? hooks.finish(ctx, shape, pick, all, opts, 0) : { type: 'discard', seat, tile: tileOf(ctx, pick.kind) };
  }
  const minShanten = Math.min(...all.map((c) => c.e.shanten));
  const best = all.reduce((a, b) => (b.e.utility > a.e.utility ? b : a)).e;
  const weight = hooks.defense(ctx, { minShanten, best, threat });
  // Hard: look one draw ahead for the best few one-away discards (not while defending).
  if (ctx.level === 'hard' && minShanten === 1 && weight < 1) {
    const top = [...all].filter((c) => c.e.shanten === 1).sort((a, b) => b.e.utility - a.e.utility).slice(0, 3);
    for (const c of top) {
      shape.counts[c.kind]!--;
      c.e = { ...c.e, utility: c.e.utility + LOOKAHEAD * readyQuality(ctx, shape) };
      shape.counts[c.kind]!++;
    }
  }
  const score = (c: Candidate) => c.e.utility - weight * c.danger + outer(c.kind) * 0.05 + (hooks.bonus?.(ctx, c) ?? 0);
  const chosen = all.reduce((a, b) => (score(b) > score(a) ? b : a));
  return hooks.finish ? hooks.finish(ctx, shape, chosen, all, opts, weight) : { type: 'discard', seat, tile: tileOf(ctx, chosen.kind) };
}

/**
 * The shared claim routine: always win; otherwise call when the best
 * post-call utility beats standing pat by `margin`, and `allow` agrees.
 */
export function standardClaim(
  ctx: Ctx,
  plan: Plan,
  options: Claim[],
  margin: number,
  allow: (claim: Claim, result: { utility: number; after: Shape; e: Eval }) => boolean = () => true,
): Claim {
  if (options.some((o) => o.type === 'win')) return { type: 'win' };
  const c = ctx.s.hand.claim!;
  const k = kindOf(c.tile);
  const shape = shapeOf(ctx.s, ctx.seat);
  const now = evaluate(ctx, shape, plan);
  if (ctx.level === 'easy') {
    const pong = options.find((o) => o.type === 'pong' || o.type === 'kong');
    if (pong) {
      const r = claimUtility(ctx, shape, pong, k, c.from, plan);
      if (r.e.shanten <= now.shanten && allow(pong, r) && ctx.rng.next() < 0.7) return pong;
    }
    return { type: 'pass' };
  }
  let best: Claim = { type: 'pass' };
  let bestUtility = now.utility + margin;
  for (const o of options) {
    const r = claimUtility(ctx, shape, o, k, c.from, plan);
    if (r.utility > bestUtility && allow(o, r)) {
      best = o;
      bestUtility = r.utility;
    }
  }
  return best;
}
