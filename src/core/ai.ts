// Computer players. `chooseAction(state, seat)` answers whatever the engine is
// waiting on from `seat` (a discard, a claim, a kong, a win, "ready"), always
// with a legal action. It is deterministic for a given state, so tests replay
// and any device would pick the same move (online, only the AI driver asks).
//
// Levels:
//   easy   — tile efficiency with some noise; pongs freely, never chows.
//   normal — efficiency weighed against hand value: aims for hands that reach
//            the faan minimum (a tenpai that can't legally win is worth
//            nothing), claims when the claim raises that value.
//   hard   — normal plus defence: reads who looks close to winning and
//            discards safer tiles (genbutsu, suji, dead honors) when its own
//            hand is far off.

import {
  claimOptions,
  liveLeft,
  seatWind,
  turnOptions,
  variantOf,
  visibleCounts,
  type Action,
  type AiLevel,
  type Claim,
  type MatchState,
} from './engine';
import { shanten, waits, type ShapeOptions } from './hand';
import { Rng } from './rng';
import { isHonor, isSuit, kindOf, suitOf, windKind, type Kind } from './tiles';
import type { MeldFact, PlayableVariant, WinInput } from './variants';

interface Ctx {
  s: MatchState;
  seat: number;
  level: AiLevel;
  variant: PlayableVariant;
  shape: ShapeOptions;
  visible: number[];
  bonus: Kind[];
  seatWind: number;
  minFaan: number;
  rng: Rng;
}

interface Shape {
  counts: number[];
  melds: MeldFact[];
}

export function chooseAction(s: MatchState, seat: number): Action | null {
  const h = s.hand;
  if (s.over) return null;
  if (h.phase === 'end') return h.ready[seat] ? null : { type: 'ready', seat };
  const ctx = makeCtx(s, seat);
  if (h.phase === 'claim') {
    const options = claimOptions(s, seat);
    if (options.length === 0) return null;
    return { type: 'claim', seat, claim: decideClaim(ctx, options) };
  }
  if (h.phase === 'act' && h.turn === seat) return decideTurn(ctx);
  return null;
}

function makeCtx(s: MatchState, seat: number): Ctx {
  const variant = variantOf(s);
  const p = s.hand.players[seat]!;
  const rules = s.config.rules;
  return {
    s,
    seat,
    level: s.config.seats[seat]?.level ?? 'normal',
    variant,
    shape: variant.shape(rules),
    visible: visibleCounts(s, seat),
    bonus: p.bonus.map(kindOf),
    seatWind: seatWind(s, seat),
    minFaan: 'minFaan' in rules ? rules.minFaan : 1,
    // Deterministic per decision: same state → same choice.
    rng: new Rng((s.rng ^ Math.imul(s.seq + 1, 2654435761) ^ (seat * 97)) >>> 0),
  };
}

function shapeOf(s: MatchState, seat: number): Shape {
  const p = s.hand.players[seat]!;
  const counts = new Array<number>(34).fill(0);
  for (const t of p.hand) counts[kindOf(t)]!++;
  return {
    counts,
    melds: p.melds.map((m) => ({ type: m.type, kind: m.kind, concealed: m.concealed, from: m.from, order: m.order })),
  };
}

const setsLeft = (ctx: Ctx, shape: Shape) => (ctx.variant.handSize - 1) / 3 - shape.melds.length;

// ------------------------------------------------------------ hand value

function winInput(ctx: Ctx, shape: Shape, win: Kind, selfDraw: boolean): WinInput {
  const concealed: Kind[] = [];
  shape.counts.forEach((n, k) => {
    for (let i = 0; i < n; i++) concealed.push(k);
  });
  concealed.push(win);
  return {
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
    robbingKong: false,
    lastTile: false,
    kongReplacement: 0,
    heavenly: false,
    earthly: false,
    flowerWin: null,
    wallLeft: 99,
    discardUnseen: false,
  };
}

function winValue(ctx: Ctx, shape: Shape, win: Kind, selfDraw: boolean): number | null {
  const score = ctx.variant.evaluate(winInput(ctx, shape, win, selfDraw), ctx.s.config.rules);
  return score && ctx.variant.canWin(score, ctx.s.config.rules) ? score.value : null;
}

const valueKinds = (ctx: Ctx): Kind[] => [31, 32, 33, windKind(ctx.seatWind), windKind(ctx.s.prevailing)];

/** Rough faan a 13-tile shape is heading for (used before tenpai). */
function potential(ctx: Ctx, shape: Shape): number {
  const { counts, melds } = shape;
  const open = melds.some((m) => !m.concealed);
  let v = 0.35; // self-draw chance
  if (!open) v += 1;
  // Flowers already in hand (HK: 無花 / 正花 / 一台花).
  if (ctx.bonus.length === 0) v += 1;
  else {
    v += ctx.bonus.filter((k) => (k - 34) % 4 === ctx.seatWind).length;
  }
  for (const k of valueKinds(ctx)) {
    if (melds.some((m) => m.type !== 'chi' && m.kind === k) || counts[k]! >= 3) v += 1;
    else if (counts[k] === 2) v += 0.45;
  }
  // One suit (+ honors).
  const suit = [0, 0, 0];
  let honors = 0;
  counts.forEach((n, k) => {
    if (isSuit(k)) suit[suitOf(k)]! += n;
    else if (isHonor(k)) honors += n;
  });
  for (const m of melds) {
    if (isSuit(m.kind)) suit[suitOf(m.kind)]! += 3;
    else honors += 3;
  }
  const dom = suit.indexOf(Math.max(...suit));
  const other = suit.reduce((a, n, i) => a + (i === dom ? 0 : n), 0);
  const meldsOk = melds.every((m) => !isSuit(m.kind) || suitOf(m.kind) === dom);
  if (meldsOk && other <= 3) {
    const full = other === 0 && honors === 0 ? 7 : 3;
    v += full * (1 - other / 4) * 0.85;
  }
  // All triplets.
  if (melds.every((m) => m.type !== 'chi')) {
    let tp = melds.length;
    counts.forEach((n) => {
      if (n >= 2) tp++;
    });
    if (tp >= 5) v += 2.4;
    else if (tp === 4) v += 1.1;
  }
  // Common hand (all chows): no pongs anywhere, few honor tiles.
  if (melds.every((m) => m.type === 'chi') && honors <= 2 && !counts.some((n) => n >= 3)) v += 0.6;
  return v;
}

interface Eval {
  utility: number;
  shanten: number;
  acceptance: number;
}

/** How good a hand waiting for its next tile is (13 tiles for HK). */
function evaluate(ctx: Ctx, shape: Shape): Eval {
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
  if (ctx.level === 'easy') return { utility: -sh * 12 + acceptance * 0.3, shanten: sh, acceptance };

  const valueTerm = (pot: number) => 2.2 * Math.min(pot, ctx.minFaan + 1.5) - (pot < ctx.minFaan ? (ctx.minFaan - pot) * 2.5 : 0);
  if (sh === 0) {
    let winAcc = 0;
    let faanSum = 0;
    let n = 0;
    for (const w of waits(c, sets, ctx.shape)) {
      const left = 4 - ctx.visible[w]!;
      if (left <= 0) continue;
      const ron = winValue(ctx, shape, w, false);
      const tsumo = ron ?? winValue(ctx, shape, w, true);
      if (ron !== null) winAcc += left;
      else if (tsumo !== null) winAcc += left * 0.3;
      if (tsumo !== null) {
        faanSum += tsumo * left;
        n += left;
      }
    }
    if (winAcc > 0) return { utility: 6 + winAcc * 0.8 + valueTerm(faanSum / n), shanten: 0, acceptance };
    // Tenpai that can't win: worth no more than a decent 1-shanten hand.
    return { utility: -12 + acceptance * 0.15 + valueTerm(potential(ctx, shape)), shanten: 0, acceptance };
  }
  return { utility: -sh * 12 + acceptance * 0.25 + valueTerm(potential(ctx, shape)), shanten: sh, acceptance };
}

// ------------------------------------------------------------ defence

/** 0–1: how likely each opponent is to be tenpai. */
function threats(ctx: Ctx): number[] {
  const left = liveLeft(ctx.s);
  return ctx.s.hand.players.map((p, i) => {
    if (i === ctx.seat) return 0;
    const open = p.melds.length;
    // Concealed hands get there with time; each meld is a set already made.
    const byTime = Math.min(0.75, Math.max(0, (p.discards.length - 5) / 10));
    const byMelds = open >= 3 ? 0.95 : open === 2 ? 0.55 : open === 1 ? 0.3 : 0;
    let t = Math.max(byTime, byMelds);
    if (left < 20) t += 0.15;
    return Math.min(1, t);
  });
}

function danger(ctx: Ctx, k: Kind, threat: number[]): number {
  let total = 0;
  ctx.s.hand.players.forEach((p, o) => {
    if (threat[o] === 0) return;
    const discards = p.discards.map(kindOf);
    let d: number;
    if (discards.includes(k)) d = 0;
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
    total += threat[o]! * d;
  });
  return total;
}

// ------------------------------------------------------------ decisions

function decideTurn(ctx: Ctx): Action {
  const { s, seat } = ctx;
  const opts = turnOptions(s, seat);
  if (opts.win) return { type: 'win', seat };
  const shape = shapeOf(s, seat);
  const p = s.hand.players[seat]!;

  for (const k of opts.kongs) {
    if (ctx.level === 'easy' || kongKeepsShape(ctx, shape, k)) return { type: 'kong', seat, kind: k };
  }

  const candidates: { kind: Kind; e: Eval; danger: number }[] = [];
  const threat = ctx.level === 'hard' ? threats(ctx) : [0, 0, 0, 0];
  for (let k = 0; k < 34; k++) {
    if (shape.counts[k] === 0) continue;
    shape.counts[k]!--;
    candidates.push({ kind: k, e: evaluate(ctx, shape), danger: ctx.level === 'hard' ? danger(ctx, k, threat) : 0 });
    shape.counts[k]!++;
  }
  let pick: Kind;
  if (ctx.level === 'easy') {
    const minSh = Math.min(...candidates.map((c) => c.e.shanten));
    const pool = candidates.filter((c) => c.e.shanten === minSh).sort((a, b) => b.e.utility - a.e.utility);
    pick = pool[Math.min(pool.length - 1, ctx.rng.int(Math.min(3, pool.length)))]!.kind;
  } else {
    const minSh = Math.min(...candidates.map((c) => c.e.shanten));
    const top = Math.max(...threat);
    // Push with a live tenpai, fold a far-off hand against someone who looks ready.
    const bestUtility = Math.max(...candidates.map((c) => c.e.utility));
    // Most HK hands are cheap, so dealing in costs little and folding costs
    // wins (measured: broad defence lost to plain efficiency). Defend only a
    // far-off hand against someone who shows three melds.
    const weight = minSh >= 2 && top >= 0.9 && bestUtility < 0 ? 6 : minSh >= 1 && top >= 0.9 ? 1 : 0;
    let best = candidates[0]!;
    const score = (c: (typeof candidates)[number]) => c.e.utility - weight * c.danger + outer(c.kind) * 0.05;
    for (const c of candidates) if (score(c) > score(best)) best = c;
    pick = best.kind;
  }
  // Discard the copy that isn't the freshly drawn tile when there's a choice (cosmetic).
  const tiles = p.hand.filter((t) => kindOf(t) === pick);
  const tile = tiles.find((t) => t !== s.hand.drawn) ?? tiles[0]!;
  return { type: 'discard', seat, tile };
}

const outer = (k: Kind) => (k >= 27 ? 10 : Math.max(k % 9, 8 - (k % 9)));

/** Does declaring a kong on `k` keep the hand at least as close to winning as the best discard? */
function kongKeepsShape(ctx: Ctx, shape: Shape, k: Kind): boolean {
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
  // A concealed kong becomes a new meld; an added kong upgrades an existing pong.
  return shanten(after, concealedKong ? sets - 1 : sets, ctx.shape) <= before;
}

function decideClaim(ctx: Ctx, options: Claim[]): Claim {
  if (options.some((o) => o.type === 'win')) return { type: 'win' };
  const c = ctx.s.hand.claim!;
  const k = kindOf(c.tile);
  const shape = shapeOf(ctx.s, ctx.seat);
  const sets = setsLeft(ctx, shape);
  const now = evaluate(ctx, shape);

  if (ctx.level === 'easy') {
    const pong = options.find((o) => o.type === 'pong' || o.type === 'kong');
    if (pong) {
      const after = afterClaim(shape, pong, k, c.from);
      if (shanten(after.counts, sets - 1, ctx.shape) - 1 <= now.shanten && ctx.rng.next() < 0.7) return pong;
    }
    return { type: 'pass' };
  }

  let best: Claim = { type: 'pass' };
  let bestUtility = now.utility + 0.8;
  for (const o of options) {
    const after = afterClaim(shape, o, k, c.from);
    let u: number;
    if (o.type === 'kong') {
      u = evaluate(ctx, after).utility + 1.5; // plus a free replacement draw
    } else {
      // A pong / chow is followed by a discard: value the best one.
      u = -Infinity;
      for (let d = 0; d < 34; d++) {
        if (after.counts[d] === 0) continue;
        after.counts[d]!--;
        u = Math.max(u, evaluate(ctx, after).utility);
        after.counts[d]!++;
      }
    }
    if (u > bestUtility) {
      best = o;
      bestUtility = u;
    }
  }
  return best;
}

function afterClaim(shape: Shape, claim: Claim, k: Kind, from: number): Shape {
  const counts = shape.counts.slice();
  let meld: MeldFact;
  const order = shape.melds.length;
  if (claim.type === 'chi') {
    for (const x of [claim.low, claim.low + 1, claim.low + 2]) if (x !== k) counts[x]!--;
    meld = { type: 'chi', kind: claim.low, concealed: false, from, order };
  } else {
    counts[k]! -= claim.type === 'kong' ? 3 : 2;
    meld = { type: claim.type === 'kong' ? 'kong' : 'pong', kind: k, concealed: false, from, order };
  }
  return { counts, melds: [...shape.melds, meld] };
}

// ------------------------------------------------------------ hints

export interface WaitInfo {
  kind: Kind;
  /** Copies this seat can't see anywhere. */
  left: number;
  /** Faan on a discard win, or null when it wouldn't reach the minimum. */
  ron: number | null;
  /** Faan on a self-draw, or null. */
  tsumo: number | null;
}

/** For a seat waiting for its next tile: the tiles that would complete its hand. */
export function waitInfo(s: MatchState, seat: number): WaitInfo[] {
  const ctx = makeCtx(s, seat);
  const shape = shapeOf(s, seat);
  const total = shape.counts.reduce((a, b) => a + b, 0);
  if (total % 3 !== 1) return [];
  return waits(shape.counts, setsLeft(ctx, shape), ctx.shape).map((kind) => ({
    kind,
    left: Math.max(0, 4 - ctx.visible[kind]!),
    ron: winValue(ctx, shape, kind, false),
    tsumo: winValue(ctx, shape, kind, true),
  }));
}

/** The discard a normal-level AI would make for `seat` (the UI's "hint" button). */
export function suggestDiscard(s: MatchState, seat: number): Kind | null {
  if (s.hand.phase !== 'act' || s.hand.turn !== seat) return null;
  const copy = { ...s, config: { ...s.config, seats: s.config.seats.map((x, i) => (i === seat ? { ...x, level: 'normal' as const } : x)) } };
  const a = decideTurn(makeCtx(copy, seat));
  return a.type === 'discard' ? kindOf(a.tile) : null;
}
