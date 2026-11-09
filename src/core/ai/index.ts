// Computer players. `chooseAction(state, seat)` answers whatever the engine is
// waiting on from `seat` — a discard, a claim, a kong, a win, riichi, a
// Charleston pass, "ready" — always with a legal action, and deterministically
// for a given state (so tests replay, and online only the AI driver asks).
//
// Hong Kong is played by trained networks (neural.ts, one per level — see
// src/core/nn and training/). The other variants each have a heuristic AI,
// because their rules reward different play: taiwan.ts (speed and staying
// concealed, costly to deal in, dealer streaks), riichi.ts (yaku, riichi /
// dama, furiten, push / fold), american.ts (a card planner). They share the
// toolkit in kit.ts.
//
// Heuristic levels: easy — efficiency with some noise, no defence; normal —
// the variant's value plan; hard — the same plus fuller defence.

import { claimOptions, isFuriten, type Action, type Claim, type MatchState } from '../engine';
import { waits } from '../hand';
import { kindOf, type Kind } from '../tiles';
import { americanCharleston, americanClaim, americanTurn, nearestFor } from './american';
import { makeCtx, setsLeft, shapeOf, winValue, type Ctx, type Plan } from './kit';
import { HINT_LEVEL, NEURAL_VARIANTS, neuralPlayer } from './neural';
import { riichiClaim, riichiPlan, riichiTurn } from './riichi';
import { taiwanClaim, taiwanPlan, taiwanTurn } from './taiwan';

interface VariantAI {
  turn(ctx: Ctx): Action;
  claim(ctx: Ctx, options: ReturnType<typeof claimOptions>): Claim;
  plan?(ctx: Ctx): Plan;
}

/** The heuristic AIs (every variant except the neural ones). */
const AIS: Record<string, VariantAI> = {
  taiwan: { turn: taiwanTurn, claim: taiwanClaim, plan: taiwanPlan },
  riichi: { turn: riichiTurn, claim: riichiClaim, plan: riichiPlan },
  american: { turn: americanTurn, claim: americanClaim },
};

const aiFor = (ctx: Ctx): VariantAI => AIS[ctx.variant.id]!;

export function chooseAction(s: MatchState, seat: number): Action | null {
  const h = s.hand;
  if (s.over) return null;
  if (h.phase === 'end') return h.ready[seat] ? null : { type: 'ready', seat };
  if (NEURAL_VARIANTS.has(s.config.variant)) {
    const level = s.config.seats[seat]?.level ?? 'normal';
    const player = neuralPlayer(s.config.variant, level);
    if (!player) throw new Error(`the ${s.config.variant} ${level} network isn't loaded`);
    return player.act(s, seat);
  }
  const ctx = makeCtx(s, seat);
  if (h.phase === 'charleston') return americanCharleston(ctx);
  if (h.phase === 'claim') {
    const options = claimOptions(s, seat);
    if (options.length === 0) return null;
    return { type: 'claim', seat, claim: aiFor(ctx).claim(ctx, options) };
  }
  if (h.phase === 'act' && h.turn === seat) return aiFor(ctx).turn(ctx);
  return null;
}

// ------------------------------------------------------------ hints for the UI

/** The discard the strongest AI would make for `seat` (null while a network is still loading). */
export function suggestDiscard(s: MatchState, seat: number): Kind | null {
  if (s.hand.phase !== 'act' || s.hand.turn !== seat) return null;
  if (NEURAL_VARIANTS.has(s.config.variant)) return neuralPlayer(s.config.variant, HINT_LEVEL)?.hint(s, seat) ?? null;
  const copy = { ...s, config: { ...s.config, seats: s.config.seats.map((x, i) => (i === seat ? { ...x, level: 'normal' as const } : x)) } };
  const ctx = makeCtx(copy, seat);
  const a = aiFor(ctx).turn(ctx);
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
  if (ctx.variant.features.american) return []; // a card, not a shape
  const shape = shapeOf(s, seat);
  if (shape.counts.reduce((a, b) => a + b, 0) % 3 !== 1) return [];
  const riichi = AIS[ctx.variant.id]?.plan?.(ctx).riichi(ctx, shape) ?? 0;
  const furiten = ctx.variant.features.riichi && isFuriten(s, seat);
  return waits(shape.counts, setsLeft(ctx, shape), ctx.shape).map((kind) => ({
    kind,
    left: Math.max(0, 4 - ctx.visible[kind]!),
    ron: furiten ? null : winValue(ctx, shape, kind, false, riichi && s.hand.riichi[seat] ? 1 : 0),
    tsumo: winValue(ctx, shape, kind, true, riichi && s.hand.riichi[seat] ? 1 : 0),
  }));
}

/** American: the nearest hands on the card for `seat`. */
export function nearestHands(s: MatchState, seat: number, limit = 4) {
  return nearestFor(makeCtx(s, seat), limit);
}
