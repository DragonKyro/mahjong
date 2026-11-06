import { describe, expect, it } from 'vitest';
import { chooseAction } from './ai';
import { applyAction, createMatch, pendingSeats, variantOf, type AiLevel, type MatchState } from './engine';
import { tileIds } from './tiles';
import { defaultRulesFor, type AnyRules, type VariantId } from './variants';
import { DEFAULT_HK_RULES, type HkRules } from './variants/hk';

function conserved(s: MatchState): boolean {
  const all = tileIds(variantOf(s).tiles);
  const h = s.hand;
  const held = [
    ...h.wall.slice(h.head, h.tail),
    ...h.players.flatMap((p) => [...p.hand, ...p.bonus, ...p.discards, ...p.melds.flatMap((m) => m.tiles)]),
  ].sort((a, b) => a - b);
  return held.length === all.length && held.every((t, i) => t === all[i]);
}

/** Play a whole match with AI in every seat; returns the final state. */
export function playOut(seed: number, levels: AiLevel[], rules: AnyRules = DEFAULT_HK_RULES, variant: VariantId = 'hk', maxActions = 20000): MatchState {
  let s = createMatch({ variant, rules, seed, seats: levels.map((level, i) => ({ name: `AI ${i}`, ai: true, level })) });
  for (let n = 0; n < maxActions && !s.over; n++) {
    const seat = pendingSeats(s)[0]!;
    const action = chooseAction(s, seat);
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

const handsWon = (s: MatchState) => s.history.filter((h) => h.wins.length > 0).length;

describe('AI', () => {
  it.each(['easy', 'normal', 'hard'] as const)('plays whole HK %s matches legally', (level) => {
    const s = playOut(11, [level, level, level, level]);
    expect(s.history.length).toBeGreaterThanOrEqual(4);
  });

  it('wins a fair share of HK hands (the 3-faan minimum is reachable)', () => {
    let hands = 0;
    let wins = 0;
    for (const seed of [1, 2, 3]) {
      const s = playOut(seed, ['normal', 'normal', 'hard', 'hard']);
      hands += s.history.length;
      wins += handsWon(s);
    }
    expect(wins / hands).toBeGreaterThan(0.4);
  });

  it('copes with HK house rules (seven pairs, multi-win, full gun, chicken hands)', () => {
    const rules: HkRules = { ...DEFAULT_HK_RULES, sevenPairs: true, multiWin: true, payment: 'fullGun', minFaan: 0, rounds: 1 };
    expect(playOut(5, ['hard', 'normal', 'easy', 'hard'], rules).over).toBe(true);
  });

  it('is deterministic', () => {
    const a = playOut(21, ['normal', 'hard', 'easy', 'normal']);
    const b = playOut(21, ['normal', 'hard', 'easy', 'normal']);
    expect(a.scores).toEqual(b.scores);
    expect(a.seq).toBe(b.seq);
  });

  it.each(['taiwan', 'riichi', 'american'] as const)('plays whole %s matches at every level', (variant) => {
    for (const [seed, levels] of [
      [31, ['easy', 'easy', 'easy', 'easy']],
      [32, ['normal', 'hard', 'normal', 'hard']],
      [33, ['hard', 'easy', 'normal', 'hard']],
    ] as const) {
      const s = playOut(seed, [...levels], defaultRulesFor(variant), variant);
      expect(s.history.length).toBeGreaterThanOrEqual(4);
    }
  });

  it.each([
    ['taiwan', 0.5],
    ['riichi', 0.5],
    ['american', 0.2],
  ] as const)('wins a fair share of %s hands', (variant, rate) => {
    let hands = 0;
    let wins = 0;
    for (const seed of [41, 42, 43, 44]) {
      const s = playOut(seed, ['normal', 'hard', 'normal', 'hard'], defaultRulesFor(variant), variant);
      hands += s.history.length;
      wins += handsWon(s);
    }
    expect(wins / hands).toBeGreaterThan(rate);
  });
});
