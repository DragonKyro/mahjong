// A batch of HK matches for an out-of-process learner. Each env runs one
// match at a time; whenever the game waits on a seat played by a network
// (any controller name other than a heuristic level), the env stops and
// hands out a request: that seat's observation, legal mask and the reward it
// collected since its previous request. Heuristic seats, confirming a hand
// result and (optionally) forced single-option moves are played here.
//
// One request per env at a time, in the engine's pending order, so a claim
// window asks seats one by one; a seat that can no longer change the outcome
// is never asked (the engine resolves the window early).
//
// Reward: score change / rewardScale at every hand end, plus rankReward[rank]
// when the match ends. Seat controllers rotate one seat each match, so every
// network plays every seat and dealer order.

import { chooseAction } from '@/core/ai';
import { applyAction, createMatch, handCounts, pendingSeats, setsNeeded, type AiLevel, type MatchState } from '@/core/engine';
import { shanten, waits } from '@/core/hand';
import { decodeSlot, legalMask, NUM_SLOTS, SLOT } from '@/core/nn/hkActions';
import { OBS_DIM, observe } from '@/core/nn/hkEncode';
import { normalizeHkRules, type HkRules } from '@/core/variants/hk';

const HEURISTIC = new Set(['easy', 'normal', 'hard']);

export interface VecEnvOptions {
  numEnvs: number;
  seed: number;
  /** Controller per seat: 'easy' | 'normal' | 'hard' = the heuristic AI, any other name = a network (returned as `who`). */
  seats: string[];
  /** Points per unit of reward (default: the starting score). */
  rewardScale: number;
  /** Added at the match end by final rank (1st … 4th). */
  rankReward: number[];
  rules: Partial<HkRules>;
  /** Play decisions with a single legal slot without asking. */
  autoForced: boolean;
  /** Return auxiliary targets with every request (training only — they are hidden information). */
  aux: boolean;
  /** Give up on a match after this many actions. */
  maxActions: number;
}

export const DEFAULT_OPTIONS: VecEnvOptions = {
  numEnvs: 16,
  seed: 1,
  seats: ['learner', 'learner', 'learner', 'learner'],
  rewardScale: 0,
  rankReward: [0, 0, 0, 0],
  rules: {},
  autoForced: true,
  aux: false,
  maxActions: 20_000,
};

/** Per opponent (next, across, prev): concealed counts / 4 (34), ready (1), waits (34). */
export const AUX_PER_SEAT = 69;
export const AUX_DIM = 3 * AUX_PER_SEAT;

export interface Episode {
  env: number;
  match: number;
  seed: number;
  /** Controller per physical seat. */
  who: string[];
  scores: number[];
  hands: number;
  actions: number;
  truncated: boolean;
}

export interface Done {
  env: number;
  seat: number;
  who: string;
  /** Reward since the seat's last request, the rank reward included. */
  reward: number;
}

export interface VecBatch {
  env: number[];
  seat: number[];
  who: string[];
  obs: Float32Array;
  mask: Uint8Array;
  reward: number[];
  aux: Float32Array | null;
  done: Done[];
  episodes: Episode[];
}

interface Env {
  s: MatchState;
  match: number;
  seed: number;
  who: string[];
  accrued: number[];
  actions: number;
  /** The seat this env is waiting on, or null. */
  pending: number | null;
}

function auxTargets(s: MatchState, seat: number, out: Float32Array, at: number): void {
  const shape = { sevenPairs: (s.config.rules as HkRules).sevenPairs, thirteenOrphans: true };
  for (let r = 1; r < 4; r++) {
    const o = (seat + r) % 4;
    const base = at + (r - 1) * AUX_PER_SEAT;
    const c = handCounts(s, o);
    c.forEach((n, k) => (out[base + k] = n / 4));
    const total = c.reduce((a, b) => a + b, 0);
    if (total % 3 === 1 && shanten(c, setsNeeded(s, o), shape) === 0) {
      out[base + 34] = 1;
      for (const k of waits(c, setsNeeded(s, o), shape)) out[base + 35 + k] = 1;
    }
  }
}

export class HkVecEnv {
  readonly opts: VecEnvOptions;
  private envs: Env[] = [];
  private nextMatch = 0;
  private done: Done[] = [];
  private episodes: Episode[] = [];

  constructor(options: Partial<VecEnvOptions> = {}) {
    this.opts = { ...DEFAULT_OPTIONS, ...options };
    if (this.opts.seats.length !== 4) throw new Error('seats needs four controllers');
  }

  private rules(): HkRules {
    return normalizeHkRules(this.opts.rules);
  }

  private scale(): number {
    return this.opts.rewardScale > 0 ? this.opts.rewardScale : this.rules().startingScore;
  }

  private newMatch(i: number): Env {
    const match = this.nextMatch++;
    const seed = (this.opts.seed * 1_000_003 + match) >>> 0;
    const rot = match % 4;
    const who = [0, 1, 2, 3].map((seat) => this.opts.seats[(seat + rot) % 4]!);
    const s = createMatch({
      variant: 'hk',
      rules: this.rules(),
      seed,
      seats: who.map((w, k) => ({ name: `${w}${k}`, ai: true, level: HEURISTIC.has(w) ? (w as AiLevel) : 'normal' })),
    });
    const env: Env = { s, match, seed, who, accrued: [0, 0, 0, 0], actions: 0, pending: null };
    this.envs[i] = env;
    return env;
  }

  private apply(env: Env, action: Parameters<typeof applyAction>[1]): void {
    const before = env.s.scores;
    env.s = applyAction(env.s, action);
    env.actions++;
    const scale = this.scale();
    env.s.scores.forEach((x, k) => (env.accrued[k]! += (x - before[k]!) / scale));
  }

  private finish(i: number, env: Env, truncated: boolean): void {
    const order = [0, 1, 2, 3].sort((a, b) => env.s.scores[b]! - env.s.scores[a]! || a - b);
    order.forEach((seat, rank) => {
      if (HEURISTIC.has(env.who[seat]!)) return;
      this.done.push({ env: i, seat, who: env.who[seat]!, reward: env.accrued[seat]! + (truncated ? 0 : this.opts.rankReward[rank] ?? 0) });
    });
    this.episodes.push({
      env: i,
      match: env.match,
      seed: env.seed,
      who: env.who,
      scores: env.s.scores.slice(),
      hands: env.s.history.length,
      actions: env.actions,
      truncated,
    });
  }

  /** Play until the env waits on a network seat. */
  private advance(i: number): void {
    let env = this.envs[i]!;
    for (;;) {
      if (env.s.over || env.actions >= this.opts.maxActions) {
        this.finish(i, env, !env.s.over);
        env = this.newMatch(i);
        continue;
      }
      const seat = pendingSeats(env.s)[0]!;
      const who = env.who[seat]!;
      if (HEURISTIC.has(who)) {
        this.apply(env, chooseAction(env.s, seat)!);
        continue;
      }
      const mask = legalMask(env.s, seat);
      if (mask[SLOT.ready]) {
        this.apply(env, decodeSlot(env.s, seat, SLOT.ready));
        continue;
      }
      if (this.opts.autoForced) {
        let only = -1;
        let n = 0;
        mask.forEach((x, k) => x && (n++, (only = k)));
        if (n === 1) {
          this.apply(env, decodeSlot(env.s, seat, only));
          continue;
        }
      }
      env.pending = seat;
      return;
    }
  }

  private batch(): VecBatch {
    const waiting = this.envs.map((e, i) => ({ e, i })).filter(({ e }) => e.pending !== null);
    const n = waiting.length;
    const obs = new Float32Array(n * OBS_DIM);
    const mask = new Uint8Array(n * NUM_SLOTS);
    const aux = this.opts.aux ? new Float32Array(n * AUX_DIM) : null;
    const reward: number[] = [];
    waiting.forEach(({ e }, j) => {
      const seat = e.pending!;
      obs.set(observe(e.s, seat), j * OBS_DIM);
      mask.set(legalMask(e.s, seat), j * NUM_SLOTS);
      if (aux) auxTargets(e.s, seat, aux, j * AUX_DIM);
      reward.push(e.accrued[seat]!);
      e.accrued[seat] = 0;
    });
    const out: VecBatch = {
      env: waiting.map(({ i }) => i),
      seat: waiting.map(({ e }) => e.pending!),
      who: waiting.map(({ e }) => e.who[e.pending!]!),
      obs,
      mask,
      reward,
      aux,
      done: this.done,
      episodes: this.episodes,
    };
    this.done = [];
    this.episodes = [];
    return out;
  }

  reset(): VecBatch {
    this.envs = [];
    this.nextMatch = 0;
    this.done = [];
    this.episodes = [];
    for (let i = 0; i < this.opts.numEnvs; i++) {
      this.newMatch(i);
      this.advance(i);
    }
    return this.batch();
  }

  /** One slot per request of the previous batch, in its order. */
  step(actions: number[]): VecBatch {
    const waiting = this.envs.map((e, i) => ({ e, i })).filter(({ e }) => e.pending !== null);
    if (actions.length !== waiting.length) throw new Error(`expected ${waiting.length} actions, got ${actions.length}`);
    waiting.forEach(({ e, i }, j) => {
      const seat = e.pending!;
      const slot = actions[j]!;
      if (!legalMask(e.s, seat)[slot]) throw new Error(`env ${i}: slot ${slot} is not legal for seat ${seat}`);
      e.pending = null;
      this.apply(e, decodeSlot(e.s, seat, slot));
      this.advance(i);
    });
    return this.batch();
  }
}
