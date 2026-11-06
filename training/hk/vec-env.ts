// A batch of HK matches for an out-of-process learner. Each env runs one
// match at a time; whenever the game waits on a seat played by a network, the
// env stops and hands out a request: that seat's observation (its own view
// only — see src/core/nn/hkEncode.ts), its legal mask, and the reward it
// collected since its previous request.
//
// Seat controllers:
//   'easy' | 'normal' | 'hard'  the heuristic AI plays here, no request
//   'teacher'                   a request carrying the heuristic AI's move as `hint`
//                               (imitation: the learner sends the hint back)
//   anything else               a network; the name comes back as `who`
//
// Fair play: in a claim window every seat still deciding is asked at once,
// from the same state, and all the answers are applied afterwards — as at a
// real table, nobody's decision can depend on whether another seat called.
// (Asking one seat at a time would leak that: the engine closes a window as
// soon as no remaining seat can outrank the best answer so far.)
//
// Reward: score change / rewardScale, delivered with the seat's next request
// or in a `done` record when its episode ends — at every hand end
// (episode 'hand') or at the match end (episode 'match'). rankReward[rank] is
// added at the match end.

import { chooseAction } from '@/core/ai';
import { applyAction, handCounts, isFinalHand, pendingSeats, setsNeeded, createMatch, type Action, type AiLevel, type MatchState } from '@/core/engine';
import { shanten, waits } from '@/core/hand';
import { decodeSlot, legalMask, NUM_SLOTS, slotOf } from '@/core/nn/hkActions';
import { OBS_DIM, observe } from '@/core/nn/hkEncode';
import { normalizeHkRules, type HkRules } from '@/core/variants/hk';

const HEURISTIC = new Set(['easy', 'normal', 'hard']);
const isNetwork = (who: string) => !HEURISTIC.has(who);

export interface VecEnvOptions {
  numEnvs: number;
  seed: number;
  /** Controller per seat (see above). */
  seats: string[];
  teacherLevel: AiLevel;
  /**
   * 'match': a fresh seed every match and the controllers move one seat on.
   * 'paired': each seed is played twice, the controllers swapped between the
   * two (seats 0/2 ↔ 1/3) — evaluation without deal luck.
   */
  schedule: 'match' | 'paired';
  /** Stop starting matches after this many in total (0 = never stop). Idle envs make no requests. */
  maxMatches: number;
  /** Points per unit of reward. */
  rewardScale: number;
  /** Added at the match end by final rank (1st … 4th). */
  rankReward: number[];
  episode: 'hand' | 'match';
  rules: Partial<HkRules>;
  /** Play decisions with a single legal slot without asking. */
  autoForced: boolean;
  /** Auxiliary targets with every request: the opponents' hidden hands and waits. Training labels only — never part of the observation. */
  aux: boolean;
  /** Give up on a match after this many actions. */
  maxActions: number;
}

export const DEFAULT_OPTIONS: VecEnvOptions = {
  numEnvs: 16,
  seed: 1,
  seats: ['learner', 'learner', 'learner', 'learner'],
  teacherLevel: 'normal',
  schedule: 'match',
  maxMatches: 0,
  rewardScale: 32,
  rankReward: [0, 0, 0, 0],
  episode: 'hand',
  rules: {},
  autoForced: true,
  aux: false,
  maxActions: 20_000,
};

/** Per opponent (next, across, prev): concealed counts / 4 (34), ready (1), waits (34). */
export const AUX_PER_SEAT = 69;
export const AUX_DIM = 3 * AUX_PER_SEAT;

export interface SeatStats {
  wins: number;
  selfDraws: number;
  dealIns: number;
  /** Faan summed over the seat's wins. */
  faan: number;
}

export interface Episode {
  env: number;
  match: number;
  seed: number;
  /** Controller per physical seat. */
  who: string[];
  scores: number[];
  stats: SeatStats[];
  hands: number;
  actions: number;
  truncated: boolean;
}

export interface Done {
  env: number;
  seat: number;
  who: string;
  /** Reward since the seat's last request (the rank reward included at a match end). */
  reward: number;
}

export interface VecBatch {
  n: number;
  env: number[];
  seat: number[];
  who: string[];
  /** The heuristic's slot for teacher seats, else −1. */
  hint: number[];
  reward: number[];
  /** The state's action count when asked (requests from one claim window share it). */
  seq: number[];
  /** Observations, sparse: per row its non-zero count; then the (index, value) pairs row after row. */
  nnz: Uint16Array;
  idx: Uint16Array;
  val: Float32Array;
  mask: Uint8Array;
  aux: Float32Array | null;
  done: Done[];
  episodes: Episode[];
  /** Every env is idle (maxMatches reached and all finished). */
  finished: boolean;
}

interface Request {
  seat: number;
  mask: Uint8Array;
  hint: number;
  obs: Float32Array;
}

interface Env {
  s: MatchState | null;
  match: number;
  seed: number;
  who: string[];
  accrued: number[];
  actions: number;
  /** Outstanding network requests, all from the same state. */
  reqs: Request[];
  /** Heuristic / forced answers decided on that same state, applied together with the requests' answers. */
  deferred: Action[];
}

function auxTargets(s: MatchState, seat: number, out: Float32Array, at: number): void {
  const shape = { sevenPairs: (s.config.rules as HkRules).sevenPairs, thirteenOrphans: true };
  for (let r = 1; r < 4; r++) {
    const o = (seat + r) % 4;
    const base = at + (r - 1) * AUX_PER_SEAT;
    const c = handCounts(s, o);
    c.forEach((n, k) => (out[base + k] = n / 4));
    const total = c.reduce((a, b) => a + b, 0);
    const sets = setsNeeded(s, o);
    if (total % 3 === 1 && shanten(c, sets, shape) === 0) {
      out[base + 34] = 1;
      for (const k of waits(c, sets, shape)) out[base + 35 + k] = 1;
    }
  }
}

function seatStats(s: MatchState): SeatStats[] {
  const st = [0, 1, 2, 3].map(() => ({ wins: 0, selfDraws: 0, dealIns: 0, faan: 0 }));
  for (const h of s.history) {
    for (const w of h.wins) {
      st[w.seat]!.wins++;
      st[w.seat]!.faan += w.score.value;
      if (w.selfDraw) st[w.seat]!.selfDraws++;
      else if (w.from !== null) st[w.from]!.dealIns++;
    }
  }
  return st;
}

const ranks = (scores: number[]) => scores.map((x, i) => scores.filter((y, j) => y > x || (y === x && j < i)).length);

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

  private newMatch(i: number): boolean {
    const o = this.opts;
    if (o.maxMatches > 0 && this.nextMatch >= o.maxMatches) {
      this.envs[i] = { s: null, match: -1, seed: 0, who: [], accrued: [0, 0, 0, 0], actions: 0, reqs: [], deferred: [] };
      return false;
    }
    const match = this.nextMatch++;
    const paired = o.schedule === 'paired';
    const seed = paired ? (o.seed + Math.floor(match / 2)) >>> 0 : (Math.imul(o.seed, 1_000_003) + match) >>> 0;
    const rot = paired ? match % 2 : match % 4;
    const who = [0, 1, 2, 3].map((seat) => o.seats[(seat + rot) % 4]!);
    const s = createMatch({
      variant: 'hk',
      rules: normalizeHkRules(o.rules),
      seed,
      seats: who.map((w, k) => ({ name: `${w}${k}`, ai: true, level: HEURISTIC.has(w) ? (w as AiLevel) : o.teacherLevel })),
    });
    this.envs[i] = { s, match, seed, who, accrued: [0, 0, 0, 0], actions: 0, reqs: [], deferred: [] };
    return true;
  }

  private apply(env: Env, action: Action): void {
    const before = env.s!.scores;
    env.s = applyAction(env.s!, action);
    env.actions++;
    env.s.scores.forEach((x, k) => (env.accrued[k]! += (x - before[k]!) / this.opts.rewardScale));
  }

  /** Apply answers decided on one state. Claim answers that a closed window made moot are dropped. */
  private applyAll(env: Env, actions: Action[]): void {
    const c = env.s!.hand.claim;
    const window = c ? { tile: c.tile, from: c.from } : null;
    for (const a of actions) {
      if (a.type === 'claim') {
        const h = env.s!.hand;
        if (h.phase !== 'claim' || !h.claim || !window || h.claim.tile !== window.tile || h.claim.from !== window.from || h.claim.responses[a.seat] !== null) continue;
      }
      this.apply(env, a);
    }
  }

  private emitDone(i: number, env: Env, bonus: number[] | null): void {
    env.who.forEach((who, seat) => {
      if (!isNetwork(who)) return;
      this.done.push({ env: i, seat, who, reward: env.accrued[seat]! + (bonus?.[seat] ?? 0) });
      env.accrued[seat] = 0;
    });
  }

  private rankBonus(s: MatchState): number[] {
    return ranks(s.scores).map((r) => this.opts.rankReward[r] ?? 0);
  }

  private finish(i: number, env: Env, truncated: boolean): void {
    const s = env.s!;
    // Hand episodes were closed at each hand's end; close what's left (a cut-off hand).
    if (this.opts.episode === 'match' || truncated) this.emitDone(i, env, truncated ? null : this.rankBonus(s));
    this.episodes.push({
      env: i,
      match: env.match,
      seed: env.seed,
      who: env.who,
      scores: s.scores.slice(),
      stats: seatStats(s),
      hands: s.history.length,
      actions: env.actions,
      truncated,
    });
  }

  /** Play until the env waits on network seats (or goes idle). */
  private advance(i: number): void {
    for (;;) {
      const env = this.envs[i]!;
      const s = env.s;
      if (!s) return;
      if (s.over || env.actions >= this.opts.maxActions) {
        this.finish(i, env, !s.over);
        if (!this.newMatch(i)) return;
        continue;
      }
      if (s.hand.phase === 'end') {
        if (this.opts.episode === 'hand') this.emitDone(i, env, isFinalHand(s) ? this.rankBonus(s) : null);
        for (const seat of pendingSeats(s)) this.apply(env, { type: 'ready', seat });
        continue;
      }
      const reqs: Request[] = [];
      const deferred: Action[] = [];
      for (const seat of pendingSeats(s)) {
        const who = env.who[seat]!;
        if (!isNetwork(who)) {
          deferred.push(chooseAction(s, seat)!);
          continue;
        }
        const mask = legalMask(s, seat);
        if (this.opts.autoForced) {
          let n = 0;
          let only = -1;
          for (let k = 0; k < NUM_SLOTS; k++) if (mask[k]) (n++, (only = k));
          if (n === 1) {
            deferred.push(decodeSlot(s, seat, only));
            continue;
          }
        }
        const hint = who === 'teacher' ? slotOf(s, chooseAction(s, seat)!) : -1;
        reqs.push({ seat, mask, hint, obs: observe(s, seat, mask) });
      }
      if (reqs.length === 0) {
        this.applyAll(env, deferred);
        continue;
      }
      env.reqs = reqs;
      env.deferred = deferred;
      return;
    }
  }

  private batch(): VecBatch {
    const rows: { i: number; e: Env; r: Request }[] = [];
    this.envs.forEach((e, i) => e.reqs.forEach((r) => rows.push({ i, e, r })));
    const n = rows.length;
    const nnz = new Uint16Array(n);
    let total = 0;
    rows.forEach(({ r }, j) => {
      let c = 0;
      for (let k = 0; k < OBS_DIM; k++) if (r.obs[k] !== 0) c++;
      nnz[j] = c;
      total += c;
    });
    const idx = new Uint16Array(total);
    const val = new Float32Array(total);
    const mask = new Uint8Array(n * NUM_SLOTS);
    const aux = this.opts.aux ? new Float32Array(n * AUX_DIM) : null;
    const reward: number[] = [];
    let at = 0;
    rows.forEach(({ e, r }, j) => {
      for (let k = 0; k < OBS_DIM; k++) {
        const v = r.obs[k]!;
        if (v !== 0) {
          idx[at] = k;
          val[at++] = v;
        }
      }
      mask.set(r.mask, j * NUM_SLOTS);
      if (aux) auxTargets(e.s!, r.seat, aux, j * AUX_DIM);
      reward.push(e.accrued[r.seat]!);
      e.accrued[r.seat] = 0;
    });
    const out: VecBatch = {
      n,
      env: rows.map(({ i }) => i),
      seat: rows.map(({ r }) => r.seat),
      who: rows.map(({ e, r }) => e.who[r.seat]!),
      hint: rows.map(({ r }) => r.hint),
      reward,
      seq: rows.map(({ e }) => e.s!.seq),
      nnz,
      idx,
      val,
      mask,
      aux,
      done: this.done,
      episodes: this.episodes,
      finished: this.envs.every((e) => !e.s),
    };
    this.done = [];
    this.episodes = [];
    return out;
  }

  /** The current state of env `i` (tests and debugging). */
  stateOf(i: number): MatchState | null {
    return this.envs[i]?.s ?? null;
  }

  reset(): VecBatch {
    this.envs = [];
    this.nextMatch = 0;
    this.done = [];
    this.episodes = [];
    for (let i = 0; i < this.opts.numEnvs; i++) if (this.newMatch(i)) this.advance(i);
    return this.batch();
  }

  /** One slot per request of the previous batch, in its order. */
  step(actions: ArrayLike<number>): VecBatch {
    const expected = this.envs.reduce((a, e) => a + e.reqs.length, 0);
    if (actions.length !== expected) throw new Error(`expected ${expected} actions, got ${actions.length}`);
    let j = 0;
    this.envs.forEach((e, i) => {
      if (e.reqs.length === 0) return;
      const s = e.s!;
      const answers = e.reqs.map((r) => {
        const slot = actions[j++]!;
        if (!r.mask[slot]) throw new Error(`env ${i}: slot ${slot} is not legal for seat ${r.seat}`);
        return decodeSlot(s, r.seat, slot);
      });
      const all = [...answers, ...e.deferred];
      e.reqs = [];
      e.deferred = [];
      this.applyAll(e, all);
      this.advance(i);
    });
    return this.batch();
  }
}
