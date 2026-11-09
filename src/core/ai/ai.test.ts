import { describe, expect, it } from 'vitest';
import { chooseAction } from './index';
import { applyAction, createMatch, pendingSeats } from '../engine';
import { defaultRulesFor } from '../variants';
import { handsWon, playOut } from './playout';

// Hong Kong is played by trained networks (see ../nn); its heuristic player is
// tested in ../nn/teacher.test.ts. These are the heuristic variants.
describe('heuristic AIs', () => {
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

  it('is deterministic', () => {
    const a = playOut(21, ['normal', 'hard', 'easy', 'normal'], defaultRulesFor('taiwan'), 'taiwan');
    const b = playOut(21, ['normal', 'hard', 'easy', 'normal'], defaultRulesFor('taiwan'), 'taiwan');
    expect(a.scores).toEqual(b.scores);
    expect(a.seq).toBe(b.seq);
  });

  // Fixed seeds and deterministic AIs, so this is a stable check, not a sample.
  it.each(['taiwan', 'riichi', 'american'] as const)('%s: normal beats easy over paired seeds', (variant) => {
    let normal = 0;
    let easy = 0;
    for (let i = 0; i < 8; i++) {
      const mine = i % 2 ? [0, 2] : [1, 3];
      let s = createMatch({
        variant,
        rules: defaultRulesFor(variant),
        seed: 600 + Math.floor(i / 2),
        seats: [0, 1, 2, 3].map((k) => ({ name: `P${k}`, ai: true, level: mine.includes(k) ? ('normal' as const) : ('easy' as const) })),
      });
      const start = s.scores.slice();
      while (!s.over) s = applyAction(s, chooseAction(s, pendingSeats(s)[0]!)!);
      s.scores.forEach((x, k) => (mine.includes(k) ? (normal += x - start[k]!) : (easy += x - start[k]!)));
    }
    expect(normal).toBeGreaterThan(easy);
  });

  it('refuses to play a neural variant without its network', () => {
    const s = createMatch({ variant: 'hk', rules: defaultRulesFor('hk'), seed: 1, seats: [0, 1, 2, 3].map((i) => ({ name: `AI ${i}`, ai: true, level: 'hard' as const })) });
    expect(() => chooseAction(s, pendingSeats(s)[0]!)).toThrow(/network isn't loaded/);
  });
});
