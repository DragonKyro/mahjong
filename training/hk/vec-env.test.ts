import { describe, expect, it } from 'vitest';
import { pendingSeats } from '@/core/engine';
import { teacherAction } from '@/core/nn/teacher';
import { Rng } from '@/core/rng';
import { NUM_SLOTS, legalMask, slotOf } from '@/core/nn/hkActions';
import { OBS_DIM, observe } from '@/core/nn/hkEncode';
import { HkVecEnv, type VecBatch } from './vec-env';

function randomActions(b: VecBatch, rng: Rng): number[] {
  const out: number[] = [];
  for (let j = 0; j < b.n; j++) {
    const legal: number[] = [];
    for (let k = 0; k < NUM_SLOTS; k++) if (b.mask[j * NUM_SLOTS + k]) legal.push(k);
    out.push(legal[rng.int(legal.length)]!);
  }
  return out;
}

const same = (a: ArrayLike<number>, b: ArrayLike<number>) => a.length === b.length && Array.prototype.every.call(a, (x: number, i: number) => x === b[i]);

function denseRow(b: VecBatch, j: number): Float32Array {
  let at = 0;
  for (let r = 0; r < j; r++) at += b.nnz[r]!;
  const x = new Float32Array(OBS_DIM);
  for (let q = 0; q < b.nnz[j]!; q++) x[b.idx[at + q]!] = b.val[at + q]!;
  return x;
}

describe('HK vec env', () => {
  it('asks every seat in a claim window at once, from one state, with that seat’s own view', () => {
    const env = new HkVecEnv({ numEnvs: 6, seed: 4, seats: ['a', 'b', 'c', 'd'] });
    const rng = new Rng(1);
    let b = env.reset();
    let simultaneous = 0;
    for (let step = 0; step < 700; step++) {
      const byEnv = new Map<number, number[]>();
      b.env.forEach((e, j) => byEnv.set(e, [...(byEnv.get(e) ?? []), j]));
      for (const [e, rows] of byEnv) {
        const s = env.stateOf(e)!;
        const pending = pendingSeats(s);
        if (rows.length > 1) simultaneous++;
        for (const j of rows) {
          expect(b.seq[j]).toBe(s.seq); // nothing was applied since the snapshot
          expect(pending).toContain(b.seat[j]);
          expect(same(b.mask.subarray(j * NUM_SLOTS, (j + 1) * NUM_SLOTS), legalMask(s, b.seat[j]!))).toBe(true);
          if (step % 10 === 0) expect(same(denseRow(b, j), observe(s, b.seat[j]!))).toBe(true);
        }
        // Seats not asked had a single legal move (played automatically).
        for (const seat of pending) {
          if (rows.some((j) => b.seat[j] === seat)) continue;
          expect(legalMask(s, seat).reduce((a, x) => a + x, 0)).toBe(1);
        }
      }
      b = env.step(randomActions(b, rng));
    }
    expect(simultaneous).toBeGreaterThan(10);
  });

  it('teacher seats carry the heuristic AI’s move', () => {
    const env = new HkVecEnv({ numEnvs: 4, seed: 2, seats: ['teacher', 'teacher', 'teacher', 'teacher'] });
    let b = env.reset();
    for (let step = 0; step < 300; step++) {
      b.env.forEach((e, j) => {
        const s = env.stateOf(e)!;
        expect(b.hint[j]).toBe(slotOf(s, teacherAction(s, b.seat[j]!)!));
      });
      b = env.step(b.hint);
    }
  });

  it('pays each hand out as a zero-sum set of episode ends', () => {
    const env = new HkVecEnv({ numEnvs: 4, seed: 3, seats: ['teacher', 'teacher', 'teacher', 'teacher'], rewardScale: 1 });
    let b = env.reset();
    let hands = 0;
    for (let step = 0; step < 1200; step++) {
      const byEnv = new Map<number, number[]>();
      for (const d of b.done) byEnv.set(d.env, [...(byEnv.get(d.env) ?? []), d.reward]);
      for (const rewards of byEnv.values()) {
        expect(rewards.length % 4).toBe(0);
        expect(Math.abs(rewards.reduce((x, y) => x + y, 0))).toBeLessThan(1e-9);
        hands += rewards.length / 4;
      }
      expect(b.reward.every((r) => r === 0)).toBe(true); // HK scores only move at a hand's end
      b = env.step(b.hint);
    }
    expect(hands).toBeGreaterThan(5);
  });

  it('plays each paired seed twice with the seats swapped, then stops', () => {
    const env = new HkVecEnv({ numEnvs: 4, seed: 50, seats: ['net', 'normal', 'net', 'normal'], schedule: 'paired', maxMatches: 4 });
    const rng = new Rng(2);
    let b = env.reset();
    const episodes = [...b.episodes];
    for (let step = 0; step < 20000 && !b.finished; step++) {
      b = env.step(randomActions(b, rng));
      episodes.push(...b.episodes);
    }
    expect(b.finished).toBe(true);
    expect(b.n).toBe(0);
    episodes.sort((x, y) => x.match - y.match);
    expect(episodes.map((e) => e.seed)).toEqual([50, 50, 51, 51]);
    expect(episodes[0]!.who).toEqual(['net', 'normal', 'net', 'normal']);
    expect(episodes[1]!.who).toEqual(['normal', 'net', 'normal', 'net']);
  });

  it('deal copies: every copy starts each hand from the same state, reports a leave-one-out baseline, and carries on identically', () => {
    const K = 4;
    const env = new HkVecEnv({ numEnvs: 8, seed: 9, seats: ['learner', 'learner', 'learner', 'learner'], dealCopies: K, rewardScale: 1 });
    const rng = new Rng(3);
    const json = (i: number) => JSON.stringify(env.stateOf(i));
    let b = env.reset();
    // At the start, both groups' copies hold one state each (and the groups differ).
    for (const g of [0, 1]) for (let c = 1; c < K; c++) expect(json(g * K + c)).toBe(json(g * K));
    expect(json(0)).not.toBe(json(K));
    let resolved = 0;
    let differed = 0;
    for (let step = 0; step < 4000 && resolved < 6; step++) {
      const byGroup = new Map<number, typeof b.done>();
      for (const d of b.done) byGroup.set(Math.floor(d.env / K), [...(byGroup.get(Math.floor(d.env / K)) ?? []), d]);
      for (const [g, done] of byGroup) {
        // One record per copy and seat.
        expect(done).toHaveLength(K * 4);
        for (const d of done) {
          const others = done.filter((o) => o.seat === d.seat && o.env !== d.env).map((o) => o.reward);
          expect(d.baseline).toBeCloseTo(others.reduce((x, y) => x + y, 0) / (K - 1), 9);
        }
        // Each copy's hand is zero-sum.
        for (let c = 0; c < K; c++) expect(Math.abs(done.filter((d) => d.env === g * K + c).reduce((x, d) => x + d.reward, 0))).toBeLessThan(1e-9);
        if (new Set(done.map((d) => `${d.seat}:${d.reward}`)).size > 4) differed++;
        // The next hand starts from one state in every copy.
        for (let c = 1; c < K; c++) expect(json(g * K + c)).toBe(json(g * K));
        resolved++;
      }
      b = env.step(randomActions(b, rng));
    }
    expect(resolved).toBeGreaterThanOrEqual(6);
    expect(differed).toBeGreaterThan(0); // the copies really play differently
  });

  it('no deal copies: done records carry no baseline', () => {
    const env = new HkVecEnv({ numEnvs: 2, seed: 3, seats: ['teacher', 'teacher', 'teacher', 'teacher'] });
    let b = env.reset();
    let seen = 0;
    for (let step = 0; step < 600 && seen === 0; step++) {
      seen += b.done.length;
      expect(b.done.every((d) => d.baseline === null)).toBe(true);
      b = env.step(b.hint);
    }
    expect(seen).toBeGreaterThan(0);
  });
});
