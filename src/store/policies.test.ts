// The loader and the game store's use of it: fetch a network on demand, keep
// computer seats waiting until theirs is in, retry after a failure.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { clearNeural, neuralPlayer } from '@/core/ai/neural';
import { pendingSeats } from '@/core/engine';
import { DEFAULT_HK_RULES } from '@/core/variants/hk';
import { useGame } from './gameStore';
import { loadPolicy } from './policies';

const DIR = join(__dirname, '../../public/policies/hk');
let requests: string[] = [];
let failNext = 0;

beforeEach(() => {
  requests = [];
  failNext = 0;
  vi.stubGlobal('fetch', async (url: string) => {
    requests.push(url);
    if (failNext > 0) {
      failNext--;
      return { ok: false, status: 503, arrayBuffer: async () => new ArrayBuffer(0) };
    }
    const file = readFileSync(join(DIR, url.split('/').pop()!));
    return { ok: true, status: 200, arrayBuffer: async () => file.buffer.slice(file.byteOffset, file.byteOffset + file.byteLength) };
  });
});

afterEach(() => {
  useGame.getState().leave();
  clearNeural();
  vi.unstubAllGlobals();
});

describe('loadPolicy', () => {
  it('fetches a network once and registers it', async () => {
    await Promise.all([loadPolicy('hk', 'hard'), loadPolicy('hk', 'hard')]);
    await loadPolicy('hk', 'hard');
    expect(requests).toHaveLength(1);
    expect(requests[0]).toMatch(/policies\/hk\/hard\.hknet$/);
    expect(neuralPlayer('hk', 'hard')?.meta.update).toBe(5000);
    expect(neuralPlayer('hk', 'easy')).toBeNull();
  });

  it('rejects on a failed fetch and works when tried again', async () => {
    failNext = 1;
    await expect(loadPolicy('hk', 'easy')).rejects.toThrow(/503/);
    expect(neuralPlayer('hk', 'easy')).toBeNull();
    await loadPolicy('hk', 'easy');
    expect(neuralPlayer('hk', 'easy')?.meta.update).toBe(200);
  });

  it('has no network for a variant played by a heuristic', async () => {
    await expect(loadPolicy('taiwan', 'hard')).rejects.toThrow(/no taiwan network/);
  });
});

describe('the game store', () => {
  /** Start an HK game against three computers; if the human deals, let them discard so a computer is next. Returns the move count then. */
  function start(levels: ['easy' | 'normal' | 'hard', 'easy' | 'normal' | 'hard', 'easy' | 'normal' | 'hard']) {
    const game = useGame.getState();
    game.setSpeed('fast');
    game.startSolo({ ...game.soloSetup, variant: 'hk', levels, rules: { ...game.soloSetup.rules, hk: DEFAULT_HK_RULES } });
    const m = useGame.getState().match!;
    if (pendingSeats(m)[0] === 0) {
      const tile = m.hand.players[0]!.hand[0]!;
      expect(useGame.getState().act({ type: 'discard', seat: 0, tile })).toBe(true);
    }
    return useGame.getState().match!.seq;
  }
  const until = async (ok: () => boolean, ms = 8000) => {
    const t0 = Date.now();
    while (!ok()) {
      if (Date.now() - t0 > ms) throw new Error('timed out');
      await new Promise((r) => setTimeout(r, 25));
    }
  };

  it('loads the levels in play, then lets the computers move', async () => {
    const seq = start(['easy', 'normal', 'normal']);
    expect(useGame.getState().aiStatus).toBe('loading');
    await until(() => useGame.getState().match!.seq > seq);
    expect(useGame.getState().aiStatus).toBe('ready');
    const loaded = requests.map((u) => u.split('/').pop()).sort();
    expect(loaded).toEqual(['easy.hknet', 'hard.hknet', 'normal.hknet']); // hard: the hint network
    expect(neuralPlayer('hk', 'normal')).not.toBeNull();
  });

  it('keeps retrying a network that fails to load, and carries on once it arrives', async () => {
    failNext = 2;
    const seq = start(['hard', 'hard', 'hard']);
    await until(() => useGame.getState().aiStatus === 'failed');
    expect(useGame.getState().match!.seq).toBe(seq); // nobody moved without a network
    await until(() => useGame.getState().match!.seq > seq, 20000);
    expect(useGame.getState().aiStatus).toBe('ready');
  }, 30000);
});
