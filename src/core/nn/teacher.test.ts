import { describe, expect, it } from 'vitest';
import { applyAction, createMatch, pendingSeats } from '../engine';
import { handsWon, playOut } from '../ai/playout';
import { DEFAULT_HK_RULES, type HkRules } from '../variants/hk';
import { teacherAction } from './teacher';

const play = (seed: number, levels: Parameters<typeof playOut>[1], rules: HkRules = DEFAULT_HK_RULES) => playOut(seed, levels, rules, 'hk', teacherAction);

// The heuristic HK player: the imitation teacher, the "vs heuristic" benchmark and the test driver.
describe('HK heuristic (teacher)', () => {
  it.each(['easy', 'normal', 'hard'] as const)('plays whole %s matches legally', (level) => {
    expect(play(11, [level, level, level, level]).history.length).toBeGreaterThanOrEqual(4);
  });

  it('wins a fair share of hands (the 3-faan minimum is reachable)', () => {
    let hands = 0;
    let wins = 0;
    for (const seed of [1, 2, 3]) {
      const s = play(seed, ['normal', 'normal', 'hard', 'hard']);
      hands += s.history.length;
      wins += handsWon(s);
    }
    expect(wins / hands).toBeGreaterThan(0.4);
  });

  it('copes with house rules (seven pairs, multi-win, full gun, chicken hands)', () => {
    const rules: HkRules = { ...DEFAULT_HK_RULES, sevenPairs: true, multiWin: true, payment: 'fullGun', minFaan: 0, rounds: 1 };
    expect(play(5, ['hard', 'normal', 'easy', 'hard'], rules).over).toBe(true);
  });

  it('is deterministic', () => {
    const a = play(21, ['normal', 'hard', 'easy', 'normal']);
    const b = play(21, ['normal', 'hard', 'easy', 'normal']);
    expect(a.scores).toEqual(b.scores);
    expect(a.seq).toBe(b.seq);
  });

  it('normal beats easy over paired seeds', () => {
    let normal = 0;
    let easy = 0;
    for (let i = 0; i < 8; i++) {
      const mine = i % 2 ? [0, 2] : [1, 3];
      let s = createMatch({
        variant: 'hk',
        rules: DEFAULT_HK_RULES,
        seed: 600 + Math.floor(i / 2),
        seats: [0, 1, 2, 3].map((k) => ({ name: `P${k}`, ai: true, level: mine.includes(k) ? ('normal' as const) : ('easy' as const) })),
      });
      const start = s.scores.slice();
      while (!s.over) s = applyAction(s, teacherAction(s, pendingSeats(s)[0]!)!);
      s.scores.forEach((x, k) => (mine.includes(k) ? (normal += x - start[k]!) : (easy += x - start[k]!)));
    }
    expect(normal).toBeGreaterThan(easy);
  });
});
