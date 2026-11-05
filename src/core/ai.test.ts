import { describe, expect, it } from 'vitest';
import { chooseAction } from './ai';
import { applyAction, createMatch, pendingSeats, type AiLevel, type MatchState } from './engine';
import { tileIds } from './tiles';
import { DEFAULT_HK_RULES, type HkRules } from './variants/hk';

const ALL = tileIds({ bonus: 8, jokers: 0 });

function conserved(s: MatchState): boolean {
  const h = s.hand;
  const all = [
    ...h.wall.slice(h.head, h.tail),
    ...h.players.flatMap((p) => [...p.hand, ...p.bonus, ...p.discards, ...p.melds.flatMap((m) => m.tiles)]),
  ].sort((a, b) => a - b);
  return all.length === ALL.length && all.every((t, i) => t === ALL[i]);
}

/** Play a whole match with AI in every seat; returns the final state. */
export function playOut(seed: number, levels: AiLevel[], rules: HkRules = DEFAULT_HK_RULES, maxActions = 6000): MatchState {
  let s = createMatch({
    variant: 'hk',
    rules,
    seed,
    seats: levels.map((level, i) => ({ name: `AI ${i}`, ai: true, level })),
  });
  const total = s.scores.reduce((a, b) => a + b, 0);
  for (let n = 0; n < maxActions && !s.over; n++) {
    const seat = pendingSeats(s)[0]!;
    const action = chooseAction(s, seat);
    if (!action) throw new Error(`AI seat ${seat} had nothing to do in phase ${s.hand.phase}`);
    s = applyAction(s, action);
    if (s.hand.phase !== 'end' && !conserved(s)) throw new Error('tiles not conserved');
    if (s.scores.reduce((a, b) => a + b, 0) !== total) throw new Error('scores not zero-sum');
  }
  return s;
}

const handsWon = (s: MatchState) => s.history.filter((h) => h.wins.length > 0).length;

describe('AI', () => {
  it.each(['easy', 'normal', 'hard'] as const)('plays whole %s matches legally', (level) => {
    const s = playOut(11, [level, level, level, level]);
    expect(s.over).toBe(true);
    expect(s.history.length).toBeGreaterThanOrEqual(4);
  });

  it('wins a fair share of hands (the 3-faan minimum is reachable)', () => {
    let hands = 0;
    let wins = 0;
    for (const seed of [1, 2, 3]) {
      const s = playOut(seed, ['normal', 'normal', 'hard', 'hard']);
      hands += s.history.length;
      wins += handsWon(s);
    }
    expect(wins / hands).toBeGreaterThan(0.4);
  });

  it('copes with house rules (seven pairs, multi-win, full gun, chicken hands)', () => {
    const rules: HkRules = { ...DEFAULT_HK_RULES, sevenPairs: true, multiWin: true, payment: 'fullGun', minFaan: 0, rounds: 1 };
    expect(playOut(5, ['hard', 'normal', 'easy', 'hard'], rules).over).toBe(true);
  });

  it('is deterministic', () => {
    const a = playOut(21, ['normal', 'hard', 'easy', 'normal']);
    const b = playOut(21, ['normal', 'hard', 'easy', 'normal']);
    expect(a.scores).toEqual(b.scores);
    expect(a.seq).toBe(b.seq);
  });
});
