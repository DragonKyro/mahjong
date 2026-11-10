// The networks that ship in public/policies/hk: they load, they are the updates
// we picked, they differ, and they play legal moves through the game's own
// chooser. (Their strength is measured with training/hk/evaluate.py; a full
// match takes too long for a unit test.)

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { chooseAction } from '../ai';
import { clearNeural, neuralPlayer, registerNeural } from '../ai/neural';
import { suggestDiscard } from '../ai';
import { applyAction, createMatch, pendingSeats, tryApply, turnOptions, type AiLevel, type MatchState } from '../engine';
import { kindOf } from '../tiles';
import { DEFAULT_HK_RULES } from '../variants/hk';
import { ACTION_SPACE_VERSION } from './hkActions';
import { ENCODER_VERSION } from './hkEncode';
import { readHkNet } from './hkNet';
import { loadHkPlayer } from './hkPlayer';
import { teacherAction } from './teacher';

const LEVELS: Record<AiLevel, number> = { easy: 200, normal: 1000, hard: 5000 };
const bytes = (level: AiLevel) => readFileSync(join(__dirname, '../../../public/policies/hk', `${level}.hknet`));

afterEach(clearNeural);

/** Positions from a heuristic-played match, every `every`th action (claims, kongs and discards alike). */
function positions(every: number, cap: number): MatchState[] {
  const out: MatchState[] = [];
  let s = createMatch({ variant: 'hk', rules: DEFAULT_HK_RULES, seed: 77, seats: [0, 1, 2, 3].map((i) => ({ name: `T${i}`, ai: true, level: 'normal' as const })) });
  for (let n = 0; out.length < cap && !s.over; n++) {
    if (n % every === 0) out.push(s);
    s = applyAction(s, teacherAction(s, pendingSeats(s)[0]!)!);
  }
  return out;
}

describe('shipped HK networks', () => {
  it.each(Object.entries(LEVELS))('%s is training update %i, built for this encoder and action space', (level, update) => {
    const { header } = readHkNet(bytes(level as AiLevel));
    expect(header.meta?.update).toBe(update);
    expect(header.encoderVersion).toBe(ENCODER_VERSION);
    expect(header.actionSpaceVersion).toBe(ACTION_SPACE_VERSION);
    expect(bytes(level as AiLevel).length).toBeLessThan(2_000_000);
  });

  it('are three different networks', () => {
    const files = (Object.keys(LEVELS) as AiLevel[]).map((l) => bytes(l).toString('base64'));
    expect(new Set(files).size).toBe(3);
  });

  it('play only legal moves through chooseAction, and suggest a discard from the hard one', () => {
    for (const level of Object.keys(LEVELS) as AiLevel[]) registerNeural('hk', level, loadHkPlayer(bytes(level)));
    expect(neuralPlayer('hk', 'hard')?.meta.update).toBe(5000);
    let hints = 0;
    for (const base of positions(9, 28)) {
      for (const level of Object.keys(LEVELS) as AiLevel[]) {
        // The same position, played by a seat of each level.
        const s: MatchState = { ...base, config: { ...base.config, seats: base.config.seats.map((x) => ({ ...x, level })) } };
        for (const seat of pendingSeats(s)) {
          const action = chooseAction(s, seat);
          expect(action, `${level} seat ${seat}`).not.toBeNull();
          expect(tryApply(s, action!), `${level} ${JSON.stringify(action)}`).not.toBeNull();
        }
      }
      const seat = base.hand.turn;
      if (base.hand.phase === 'act' && turnOptions(base, seat).canDiscard) {
        const hint = suggestDiscard(base, seat);
        expect(hint).not.toBeNull();
        expect(base.hand.players[seat]!.hand.some((t) => kindOf(t) === hint)).toBe(true);
        expect(suggestDiscard(base, seat)).toBe(hint); // cached per state
        hints++;
      }
    }
    expect(hints).toBeGreaterThan(5);
  });

  it('suggest nothing until the hard network is loaded', () => {
    const s = positions(1, 3)[0]!;
    expect(suggestDiscard(s, s.hand.turn)).toBeNull();
  });
});
