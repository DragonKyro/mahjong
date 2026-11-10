// Test support: play whole matches with a chooser, checking after every move
// that tiles and points are conserved.

import { applyAction, createMatch, pendingSeats, variantOf, type Action, type AiLevel, type MatchState } from '../engine';
import { tileIds } from '../tiles';
import type { AnyRules, VariantId } from '../variants';
import { DEFAULT_HK_RULES } from '../variants/hk';
import { chooseAction } from './index';

export function conserved(s: MatchState): boolean {
  const all = tileIds(variantOf(s).tiles);
  const h = s.hand;
  const held = [
    ...h.wall.slice(h.head, h.tail),
    ...h.players.flatMap((p) => [...p.hand, ...p.bonus, ...p.discards, ...p.melds.flatMap((m) => m.tiles)]),
  ].sort((a, b) => a - b);
  return held.length === all.length && held.every((t, i) => t === all[i]);
}

/** Play a whole match with the computer in every seat; returns the final state. */
export function playOut(
  seed: number,
  levels: AiLevel[],
  rules: AnyRules = DEFAULT_HK_RULES,
  variant: VariantId = 'hk',
  choose: (s: MatchState, seat: number) => Action | null = chooseAction,
  maxActions = 20000,
): MatchState {
  let s = createMatch({ variant, rules, seed, seats: levels.map((level, i) => ({ name: `AI ${i}`, ai: true, level })) });
  for (let n = 0; n < maxActions && !s.over; n++) {
    const seat = pendingSeats(s)[0]!;
    const action = choose(s, seat);
    if (!action) throw new Error(`AI seat ${seat} had nothing to do in phase ${s.hand.phase}`);
    const before = s.scores.reduce((a, b) => a + b, 0) + s.sticks * 1000;
    s = applyAction(s, action);
    if (s.hand.phase !== 'end' && !conserved(s)) throw new Error(`tiles not conserved after ${JSON.stringify(action)}`);
    // Scores plus riichi sticks on the table are conserved.
    const after = s.scores.reduce((a, b) => a + b, 0) + s.sticks * 1000;
    if (after !== before) throw new Error(`points not conserved: ${before} → ${after} after ${JSON.stringify(action)}`);
  }
  if (!s.over) throw new Error('match did not finish');
  return s;
}

export const handsWon = (s: MatchState) => s.history.filter((h) => h.wins.length > 0).length;
