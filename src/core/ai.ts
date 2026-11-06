// Computer players. `chooseAction(state, seat)` answers whatever the engine is
// waiting on from `seat` (a discard, a claim, a kong, a win, riichi, a
// Charleston pass, "ready"), always with a legal action. It is deterministic
// for a given state, so tests replay and any device would pick the same move
// (online, only the AI driver asks).
//
// Levels:
//   easy   — tile efficiency with some noise; pongs freely, never chows.
//   normal — efficiency weighed against hand value: aims for hands that can
//            legally win (the HK faan minimum, a Riichi yaku), claims when the
//            claim raises that value, declares riichi.
//   hard   — normal plus defence: reads who looks close to winning (riichi,
//            three melds) and discards safer tiles when its own hand is far.
// American uses its own planner: play toward the nearest hands on the card.

import {
  blankWinInput,
  charlestonAsk,
  claimOptions,
  indicatorIds,
  isFuriten,
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
} from './engine';
import { shanten, waits, type ShapeOptions } from './hand';
import { Rng } from './rng';
import { JOKER, ORPHANS, isHonor, isSuit, isTerminal, kindOf, suitOf, windKind, type Kind, type TileId } from './tiles';
import { cardKind, closest, holdingOf, type Holding } from './variants/american';
import { doraFromIndicator, type MeldFact, type PlayableVariant, type WinInput } from './variants';

interface Ctx {
  s: MatchState;
  seat: number;
  level: AiLevel;
  variant: PlayableVariant;
  shape: ShapeOptions;
  visible: number[];
  bonus: Kind[];
  seatWind: number;
  minimum: number;
  dora: Kind[];
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
  if (h.phase === 'charleston') return decideCharleston(ctx);
  if (h.phase === 'claim') {
    const options = claimOptions(s, seat);
    if (options.length === 0) return null;
    return { type: 'claim', seat, claim: ctx.variant.features.american ? decideAmericanClaim(ctx, options) : decideClaim(ctx, options) };
  }
  if (h.phase === 'act' && h.turn === seat) return ctx.variant.features.american ? decideAmericanTurn(ctx) : decideTurn(ctx);
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
    minimum: variant.minimum(rules),
    dora: indicatorIds(s).dora.map((t) => doraFromIndicator(kindOf(t))),
    // Deterministic per decision: same state → same choice.
    rng: new Rng((s.rng ^ Math.imul(s.seq + 1, 2654435761) ^ (seat * 97)) >>> 0),
  };
}

function shapeOf(s: MatchState, seat: number): Shape {
  const p = s.hand.players[seat]!;
  const counts = new Array<number>(34).fill(0);
  for (const t of p.hand) counts[kindOf(t)]!++;
  return { counts, melds: meldFacts(p) };
}

const setsLeft = (ctx: Ctx, shape: Shape) => (ctx.variant.handSize - 1) / 3 - shape.melds.length;
const riichiOn = (ctx: Ctx) => ctx.variant.features.riichi;
const isOpen = (shape: Shape) => shape.melds.some((m) => !m.concealed);

// ------------------------------------------------------------ hand value

function winInput(ctx: Ctx, shape: Shape, win: Kind, selfDraw: boolean): WinInput {
  const concealed: Kind[] = [];
  shape.counts.forEach((n, k) => {
    for (let i = 0; i < n; i++) concealed.push(k);
  });
  concealed.push(win);
  // A concealed Riichi hand would declare riichi, so value it as one.
  const riichi = riichiOn(ctx) && (ctx.s.hand.riichi[ctx.seat] || !isOpen(shape)) ? 1 : 0;
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

function winValue(ctx: Ctx, shape: Shape, win: Kind, selfDraw: boolean): number | null {
  const rules = ctx.s.config.rules;
  const score = ctx.variant.evaluate(winInput(ctx, shape, win, selfDraw), rules);
  return score && ctx.variant.canWin(score, rules) ? score.value : null;
}

const valueKinds = (ctx: Ctx): Kind[] => [31, 32, 33, windKind(ctx.seatWind), windKind(ctx.s.prevailing)];

function suitStats(shape: Shape): { dom: number; other: number; honors: number; meldsOk: boolean } {
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

/** Rough value (in the variant's units) a shape is heading for, before tenpai. */
function potential(ctx: Ctx, shape: Shape): number {
  const { counts, melds } = shape;
  const open = isOpen(shape);
  const id = ctx.variant.id;
  let v = 0;
  let valuePongs = 0;
  for (const k of valueKinds(ctx)) {
    if (melds.some((m) => m.type !== 'chi' && m.kind === k) || counts[k]! >= 3) valuePongs += 1;
    else if (counts[k] === 2) valuePongs += 0.45;
  }
  const { other, honors, meldsOk } = suitStats(shape);
  const flush = meldsOk && other <= 3 ? (1 - other / 4) * 0.85 : 0;
  let triplets = 0;
  if (melds.every((m) => m.type !== 'chi')) {
    let tp = melds.length;
    counts.forEach((n) => {
      if (n >= 2) tp++;
    });
    triplets = tp >= setsLeft(ctx, shape) + melds.length + 1 ? 0.8 : tp >= setsLeft(ctx, shape) + melds.length ? 0.37 : 0;
  }
  if (id === 'riichi') {
    // A yaku is required: riichi covers a concealed hand, an open one needs its own.
    const simples = [...counts.keys()].every((k) => counts[k] === 0 || (isSuit(k) && !isTerminal(k))) && melds.every((m) => isSuit(m.kind) && !isTerminal(m.kind) && !(m.type === 'chi' && (m.kind % 9 === 0 || m.kind % 9 === 6)));
    if (!open) v += 1.4;
    v += Math.min(valuePongs, 2);
    if (simples) v += 1;
    v += flush * (honors === 0 && other === 0 ? 6 : 3);
    v += triplets * 2;
    v += ctx.dora.reduce((n, d) => n + counts[d]! + melds.filter((m) => m.kind === d).length, 0);
    return v;
  }
  if (id === 'taiwan') {
    v += open ? 0.35 : 1.6;
    v += ctx.bonus.filter((k) => (k - 34) % 4 === ctx.seatWind).length;
    v += valuePongs;
    v += flush * (honors === 0 && other === 0 ? 8 : 4);
    v += triplets * 4;
    return v;
  }
  // Hong Kong.
  v += 0.35;
  if (!open) v += 1;
  if (ctx.bonus.length === 0) v += 1;
  else v += ctx.bonus.filter((k) => (k - 34) % 4 === ctx.seatWind).length;
  v += valuePongs;
  v += flush * (honors === 0 && other === 0 ? 7 : 3);
  v += triplets * 3;
  if (melds.every((m) => m.type === 'chi') && honors <= 2 && !counts.some((n) => n >= 3)) v += 0.6;
  return v;
}

interface Eval {
  utility: number;
  shanten: number;
  acceptance: number;
}

/** How good a hand waiting for its next tile is. */
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

  const min = ctx.minimum;
  const valueTerm = (pot: number) => 2.2 * Math.min(pot, min + 1.5) - (pot < min ? (min - pot) * 2.5 : 0);
  if (sh === 0) {
    let winAcc = 0;
    let valueSum = 0;
    let n = 0;
    const gone = new Set(ctx.s.hand.players[ctx.seat]!.gone.map(kindOf));
    for (const w of waits(c, sets, ctx.shape)) {
      const left = 4 - ctx.visible[w]!;
      if (left <= 0) continue;
      const ron = riichiOn(ctx) && gone.has(w) ? null : winValue(ctx, shape, w, false);
      const tsumo = ron ?? winValue(ctx, shape, w, true);
      if (ron !== null) winAcc += left;
      else if (tsumo !== null) winAcc += left * 0.3;
      if (tsumo !== null) {
        valueSum += tsumo * left;
        n += left;
      }
    }
    if (winAcc > 0) return { utility: 6 + winAcc * 0.8 + valueTerm(valueSum / n), shanten: 0, acceptance };
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
    if (ctx.s.hand.riichi[i]) return 1;
    const open = p.melds.length;
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
    const discards = p.gone.map(kindOf);
    let d: number;
    if (discards.includes(k)) d = 0;
    else if (isHonor(k)) {
      const seen = ctx.visible[k]!;
      d = seen >= 3 ? 0 : seen === 2 ? 0.3 : seen === 1 ? 0.8 : 1.2;
    } else {
      const r = k % 9;
      const suji = (r >= 3 && discards.includes(k - 3)) || (r <= 5 && discards.includes(k + 3));
      d = suji ? 0.5 : r === 0 || r === 8 ? 0.7 : r === 1 || r === 7 ? 0.9 : 1.2;
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

  // 九種九牌: abort unless thirteen orphans looks close.
  if (opts.abort && ORPHANS.filter((k) => shape.counts[k]! > 0).length < 11) return { type: 'abort', seat };

  for (const k of opts.kongs) {
    if (ctx.level === 'easy' || kongKeepsShape(ctx, shape, k)) return { type: 'kong', seat, kind: k };
  }

  const allowed = opts.allowed ? new Set(opts.allowed.map(kindOf)) : null;
  if (opts.allowed && opts.allowed.length === 1) return { type: 'discard', seat, tile: opts.allowed[0]! };

  const candidates: { kind: Kind; e: Eval; danger: number }[] = [];
  const hard = ctx.level === 'hard';
  const threat = hard || riichiOn(ctx) ? threats(ctx) : [0, 0, 0, 0];
  for (let k = 0; k < 34; k++) {
    if (shape.counts[k] === 0 || (allowed && !allowed.has(k))) continue;
    shape.counts[k]!--;
    candidates.push({ kind: k, e: evaluate(ctx, shape), danger: hard || riichiOn(ctx) ? danger(ctx, k, threat) : 0 });
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
    const bestUtility = Math.max(...candidates.map((c) => c.e.utility));
    // Most HK hands are cheap, so folding costs wins (measured); defend a
    // far-off hand against someone who shows three melds — or, in Riichi,
    // against a riichi, where hands are dearer.
    let weight = 0;
    if (hard) weight = minSh >= 2 && top >= 0.9 && bestUtility < 0 ? 6 : minSh >= 1 && top >= 0.9 ? 1 : 0;
    if (riichiOn(ctx) && top >= 1) weight = Math.max(weight, minSh >= 2 ? 10 : minSh === 1 ? (hard ? 4 : 2) : 0.5);
    let best = candidates[0]!;
    const score = (c: (typeof candidates)[number]) => c.e.utility - weight * c.danger + outer(c.kind) * 0.05;
    for (const c of candidates) if (score(c) > score(best)) best = c;
    pick = best.kind;
  }

  // Riichi: declare when the chosen discard leaves a ready hand.
  const tiles = p.hand.filter((t) => kindOf(t) === pick);
  const tile = tiles.find((t) => t !== s.hand.drawn) ?? tiles[0]!;
  if (opts.riichi.length > 0) {
    const riichiTile = opts.riichi.find((t) => kindOf(t) === pick) ?? (ctx.level === 'easy' ? undefined : bestRiichi(ctx, shape, opts.riichi));
    if (riichiTile !== undefined) return { type: 'discard', seat, tile: riichiTile, riichi: true };
  }
  return { type: 'discard', seat, tile };
}

/** Among riichi discards, the one leaving the most winning tiles. */
function bestRiichi(ctx: Ctx, shape: Shape, options: TileId[]): TileId | undefined {
  let best: TileId | undefined;
  let bestScore = -1;
  for (const t of options) {
    const k = kindOf(t);
    shape.counts[k]!--;
    const e = evaluate(ctx, shape);
    shape.counts[k]!++;
    if (e.utility > bestScore) {
      bestScore = e.utility;
      best = t;
    }
  }
  return bestScore > 6 ? best : undefined;
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
    if (pong && !riichiOn(ctx)) {
      const after = afterClaim(shape, pong, k, c.from);
      if (shanten(after.counts, sets - 1, ctx.shape) - 1 <= now.shanten && ctx.rng.next() < 0.7) return pong;
    }
    return { type: 'pass' };
  }

  let best: Claim = { type: 'pass' };
  // Opening a concealed Riichi hand gives up riichi: ask for a clearer gain.
  let bestUtility = now.utility + (riichiOn(ctx) && !isOpen(shape) ? 2.5 : 0.8);
  for (const o of options) {
    const after = afterClaim(shape, o, k, c.from);
    let u: number;
    if (o.type === 'kong') {
      u = evaluate(ctx, after).utility + 1.5;
    } else {
      u = -Infinity;
      for (let d = 0; d < 34; d++) {
        if (after.counts[d] === 0 || d === k) continue;
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
    meld = { type: 'chi', kind: claim.low, concealed: false, from, order, tiles: [] };
  } else {
    counts[k]! -= claim.type === 'kong' ? 3 : 2;
    meld = { type: claim.type === 'kong' ? 'kong' : 'pong', kind: k, concealed: false, from, order, tiles: [] };
  }
  return { counts, melds: [...shape.melds, meld] };
}

// ------------------------------------------------------------ American

function holding(ctx: Ctx, extra: TileId[] = [], remove: TileId[] = []): Holding {
  const p = ctx.s.hand.players[ctx.seat]!;
  const drop = new Set(remove);
  return holdingOf([...p.hand.filter((t) => !drop.has(t)), ...extra], p.melds);
}

/** Any joker id stands for "a joker" in a holding. */
const ANY_JOKER: TileId = 144;
const bestDistance = (h: Holding) => closest(h, 1)[0]?.distance ?? 99;

/** How much each card kind is wanted by the nearest hands (for discards and passes). */
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

function decideAmericanTurn(ctx: Ctx): Action {
  const { s, seat } = ctx;
  const opts = turnOptions(s, seat);
  if (opts.win) return { type: 'win', seat };
  const p = s.hand.players[seat]!;
  const now = holding(ctx);
  const nowDist = bestDistance(now);
  for (const swap of opts.swaps) {
    const after = holding(ctx, [ANY_JOKER], [swap.tile]); // a joker in place of the natural
    if (bestDistance(after) <= nowDist) return { type: 'swap', seat, tile: swap.tile, target: swap.target };
  }
  const want = usefulness(now);
  const options = p.hand.filter((t) => kindOf(t) !== JOKER);
  const pool = options.length > 0 ? options : p.hand;
  const ranked = pool
    .map((t) => ({ t, d: bestDistance(holding(ctx, [], [t])), w: want[cardKind(t)] ?? 0 }))
    .sort((a, b) => a.d - b.d || a.w - b.w);
  const pick = ctx.level === 'easy' ? ranked[Math.min(ranked.length - 1, ctx.rng.int(3))]! : ranked[0]!;
  return { type: 'discard', seat, tile: pick.t };
}

function decideAmericanClaim(ctx: Ctx, options: Claim[]): Claim {
  if (options.some((o) => o.type === 'win')) return { type: 'win' };
  const c = ctx.s.hand.claim!;
  const nowDist = bestDistance(holding(ctx));
  let best: Claim = { type: 'pass' };
  let bestDist = nowDist - (ctx.level === 'easy' ? 0 : 1);
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

function decideCharleston(ctx: Ctx): Action | null {
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

// ------------------------------------------------------------ hints

/** The discard a normal-level AI would make for `seat` (the UI's hint). */
export function suggestDiscard(s: MatchState, seat: number): Kind | null {
  if (s.hand.phase !== 'act' || s.hand.turn !== seat) return null;
  const copy = { ...s, config: { ...s.config, seats: s.config.seats.map((x, i) => (i === seat ? { ...x, level: 'normal' as const } : x)) } };
  const ctx = makeCtx(copy, seat);
  const a = ctx.variant.features.american ? decideAmericanTurn(ctx) : decideTurn(ctx);
  return a.type === 'discard' ? kindOf(a.tile) : null;
}

export interface WaitInfo {
  kind: Kind;
  /** Copies this seat can't see anywhere. */
  left: number;
  /** Value on a discard win, or null when it couldn't win that way (minimum, no yaku, furiten). */
  ron: number | null;
  /** Value on a self-draw, or null. */
  tsumo: number | null;
}

/** For a seat waiting for its next tile: the tiles that would complete its hand. */
export function waitInfo(s: MatchState, seat: number): WaitInfo[] {
  const ctx = makeCtx(s, seat);
  if (ctx.variant.features.american) return [];
  const shape = shapeOf(s, seat);
  const total = shape.counts.reduce((a, b) => a + b, 0);
  if (total % 3 !== 1) return [];
  const furiten = ctx.variant.features.riichi && isFuriten(s, seat);
  return waits(shape.counts, setsLeft(ctx, shape), ctx.shape).map((kind) => ({
    kind,
    left: Math.max(0, 4 - ctx.visible[kind]!),
    ron: furiten ? null : winValue(ctx, shape, kind, false),
    tsumo: winValue(ctx, shape, kind, true),
  }));
}

/** American: the nearest hands on the card for `seat` (the card panel). */
export function nearestHands(s: MatchState, seat: number, limit = 4) {
  const p = s.hand.players[seat]!;
  return closest(holdingOf(p.hand, p.melds), limit);
}

