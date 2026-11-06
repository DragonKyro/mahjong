// The HK policy / value network: a forward pass in plain TypeScript, so a
// network trained in PyTorch (training/hk/model.py — the same layers, the same
// tensor names) can play in the browser and in the Node env server.
//
//   planes [P × 34] ──conv3──┐
//   globals [G] ──linear──────┴─(+ per channel)→ relu        stem, C channels
//   B × residual block: relu(x + conv3(relu(conv3(x))))       C channels × 34 kinds
//   ├─ conv1 → relu → flatten (N × 34) ─┐
//   globals ──linear → relu (Hg) ───────┴→ linear → relu       trunk z (H)
//   policy logits = linear(z) [78] + per-kind conv1 of x       added to discard k / kong k
//   value = linear(relu(linear(z)))                            expected score change (scaled)
//
// Convolutions run along the 34 tile kinds (kernel 3, zero padding), so
// neighbouring ranks share filters; flattening before the trunk keeps where
// each kind sits (suit edges, honours). The per-kind policy term gives the
// discard and kong logits a tile-wise path that doesn't go through the
// flatten. No normalisation layers (RL targets drift; nothing to keep in sync
// between train and eval) — residual blocks start as the identity instead.

import type { Action, MatchState } from '../engine';
import { ACTION_SPACE_VERSION, NUM_SLOTS, SLOT, decodeSlot, legalMask } from './hkActions';
import { ENCODER_VERSION, GLOBAL_DIM, KINDS, NUM_PLANES, observe } from './hkEncode';

export const NET_FORMAT = 'mahjong/hknet@1';

export interface HkNetConfig {
  planes: number;
  globals: number;
  channels: number;
  blocks: number;
  neck: number;
  globalHidden: number;
  hidden: number;
  valueHidden: number;
  slots: number;
}

/** The planned size: ~1.6M parameters, ~25M multiply-adds per decision. */
export const DEFAULT_NET_CONFIG: HkNetConfig = {
  planes: NUM_PLANES,
  globals: GLOBAL_DIM,
  channels: 128,
  blocks: 6,
  neck: 32,
  globalHidden: 256,
  hidden: 512,
  valueHidden: 128,
  slots: NUM_SLOTS,
};

export interface TensorFile {
  shape: number[];
  /** Little-endian float32, base64. */
  data: string;
}

export interface HkNetFile {
  format: typeof NET_FORMAT;
  encoderVersion: number;
  actionSpaceVersion: number;
  config: HkNetConfig;
  tensors: Record<string, TensorFile>;
  meta?: Record<string, unknown>;
}

export function decodeFloat32(b64: string): Float32Array {
  const bin = atob(b64);
  const view = new DataView(new ArrayBuffer(bin.length));
  for (let i = 0; i < bin.length; i++) view.setUint8(i, bin.charCodeAt(i));
  const out = new Float32Array(bin.length / 4);
  for (let i = 0; i < out.length; i++) out[i] = view.getFloat32(i * 4, true);
  return out;
}

export function encodeFloat32(a: Float32Array): string {
  const view = new DataView(new ArrayBuffer(a.length * 4));
  a.forEach((x, i) => view.setFloat32(i * 4, x, true));
  let bin = '';
  const bytes = new Uint8Array(view.buffer);
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]!);
  return btoa(bin);
}

/** Tensor names and shapes for a config (the PyTorch state_dict keys the runtime reads). */
export function tensorShapes(c: HkNetConfig): Record<string, number[]> {
  const t: Record<string, number[]> = {
    'stem_conv.weight': [c.channels, c.planes, 3],
    'stem_conv.bias': [c.channels],
    'stem_global.weight': [c.channels, c.globals],
    'stem_global.bias': [c.channels],
  };
  for (let b = 0; b < c.blocks; b++) {
    t[`blocks.${b}.conv1.weight`] = [c.channels, c.channels, 3];
    t[`blocks.${b}.conv1.bias`] = [c.channels];
    t[`blocks.${b}.conv2.weight`] = [c.channels, c.channels, 3];
    t[`blocks.${b}.conv2.bias`] = [c.channels];
  }
  Object.assign(t, {
    'neck.weight': [c.neck, c.channels, 1],
    'neck.bias': [c.neck],
    'global_embed.weight': [c.globalHidden, c.globals],
    'global_embed.bias': [c.globalHidden],
    'trunk.weight': [c.hidden, c.neck * KINDS + c.globalHidden],
    'trunk.bias': [c.hidden],
    'policy.weight': [c.slots, c.hidden],
    'policy.bias': [c.slots],
    'tile_policy.weight': [2, c.channels, 1],
    'tile_policy.bias': [2],
    'value1.weight': [c.valueHidden, c.hidden],
    'value1.bias': [c.valueHidden],
    'value2.weight': [1, c.valueHidden],
    'value2.bias': [1],
  });
  return t;
}

// ------------------------------------------------------------ layers

const relu = (a: Float32Array) => {
  for (let i = 0; i < a.length; i++) if (a[i]! < 0) a[i] = 0;
  return a;
};

/** y = W·x + b, W row-major [out][in]. Skips zero inputs (the encodings are sparse). */
function dense(x: Float32Array, w: Float32Array, b: Float32Array): Float32Array {
  const n = b.length;
  const m = x.length;
  const y = Float32Array.from(b);
  for (let j = 0; j < m; j++) {
    const v = x[j]!;
    if (v === 0) continue;
    for (let i = 0; i < n; i++) y[i]! += w[i * m + j]! * v;
  }
  return y;
}

/** 1-D convolution over the 34 kinds: x [cin][34] → [cout][34], kernel k (1 or 3), zero padding. */
function conv(x: Float32Array, cin: number, w: Float32Array, b: Float32Array, k: number): Float32Array {
  const cout = b.length;
  const L = KINDS;
  const y = new Float32Array(cout * L);
  const live: number[] = [];
  for (let i = 0; i < cin; i++) {
    for (let j = 0; j < L; j++) {
      if (x[i * L + j] !== 0) {
        live.push(i);
        break;
      }
    }
  }
  for (let o = 0; o < cout; o++) {
    const yo = o * L;
    const bo = b[o]!;
    for (let j = 0; j < L; j++) y[yo + j] = bo;
    for (const i of live) {
      const xi = i * L;
      if (k === 1) {
        const w0 = w[o * cin + i]!;
        for (let j = 0; j < L; j++) y[yo + j]! += w0 * x[xi + j]!;
      } else {
        const wo = (o * cin + i) * 3;
        const w0 = w[wo]!;
        const w1 = w[wo + 1]!;
        const w2 = w[wo + 2]!;
        y[yo]! += w1 * x[xi]! + w2 * x[xi + 1]!;
        for (let j = 1; j < L - 1; j++) y[yo + j]! += w0 * x[xi + j - 1]! + w1 * x[xi + j]! + w2 * x[xi + j + 1]!;
        y[yo + L - 1]! += w0 * x[xi + L - 2]! + w1 * x[xi + L - 1]!;
      }
    }
  }
  return y;
}

// ------------------------------------------------------------ the network

export interface NetOutput {
  logits: Float32Array;
  value: number;
}

export interface HkNet {
  config: HkNetConfig;
  meta: Record<string, unknown>;
  forward(obs: Float32Array): NetOutput;
}

export function loadHkNet(file: HkNetFile): HkNet {
  if (file.format !== NET_FORMAT) throw new Error(`not an HK network (${String(file.format)})`);
  if (file.encoderVersion !== ENCODER_VERSION) throw new Error(`network expects encoder v${file.encoderVersion}, this build has v${ENCODER_VERSION}`);
  if (file.actionSpaceVersion !== ACTION_SPACE_VERSION)
    throw new Error(`network expects action space v${file.actionSpaceVersion}, this build has v${ACTION_SPACE_VERSION}`);
  const c = file.config;
  if (c.planes !== NUM_PLANES || c.globals !== GLOBAL_DIM || c.slots !== NUM_SLOTS) throw new Error('network input / output sizes do not match this build');
  const W: Record<string, Float32Array> = {};
  for (const [name, shape] of Object.entries(tensorShapes(c))) {
    const t = file.tensors[name];
    if (!t) throw new Error(`missing tensor ${name}`);
    const data = decodeFloat32(t.data);
    const size = shape.reduce((a, b) => a * b, 1);
    if (t.shape.join() !== shape.join() || data.length !== size) throw new Error(`tensor ${name} should be [${shape.join(', ')}]`);
    W[name] = data;
  }
  const w = (name: string) => W[name]!;

  return {
    config: c,
    meta: file.meta ?? {},
    forward(obs: Float32Array): NetOutput {
      const P = c.planes * KINDS;
      if (obs.length !== P + c.globals) throw new Error(`observation has ${obs.length} values, expected ${P + c.globals}`);
      const planes = obs.subarray(0, P);
      const globals = obs.subarray(P);

      let x = conv(planes, c.planes, w('stem_conv.weight'), w('stem_conv.bias'), 3);
      const g = dense(globals, w('stem_global.weight'), w('stem_global.bias'));
      for (let o = 0; o < c.channels; o++) for (let j = 0; j < KINDS; j++) x[o * KINDS + j]! += g[o]!;
      relu(x);
      for (let b = 0; b < c.blocks; b++) {
        const h = relu(conv(x, c.channels, w(`blocks.${b}.conv1.weight`), w(`blocks.${b}.conv1.bias`), 3));
        const r = conv(h, c.channels, w(`blocks.${b}.conv2.weight`), w(`blocks.${b}.conv2.bias`), 3);
        for (let i = 0; i < r.length; i++) r[i]! += x[i]!;
        x = relu(r);
      }
      const neck = relu(conv(x, c.channels, w('neck.weight'), w('neck.bias'), 1));
      const ge = relu(dense(globals, w('global_embed.weight'), w('global_embed.bias')));
      const joined = new Float32Array(neck.length + ge.length);
      joined.set(neck, 0);
      joined.set(ge, neck.length);
      const z = relu(dense(joined, w('trunk.weight'), w('trunk.bias')));

      const logits = dense(z, w('policy.weight'), w('policy.bias'));
      const tile = conv(x, c.channels, w('tile_policy.weight'), w('tile_policy.bias'), 1);
      for (let k = 0; k < KINDS; k++) {
        logits[SLOT.discard + k]! += tile[k]!;
        logits[SLOT.kong + k]! += tile[KINDS + k]!;
      }
      const v1 = relu(dense(z, w('value1.weight'), w('value1.bias')));
      const value = dense(v1, w('value2.weight'), w('value2.bias'))[0]!;
      return { logits, value };
    },
  };
}

// ------------------------------------------------------------ choosing

export function maskedArgmax(logits: ArrayLike<number>, mask: ArrayLike<number>): number {
  let best = -1;
  for (let i = 0; i < logits.length; i++) if (mask[i] && (best < 0 || logits[i]! > logits[best]!)) best = i;
  return best;
}

/** Sample from softmax(logits / temperature) over legal slots, `u` uniform in [0, 1). */
export function sampleMasked(logits: ArrayLike<number>, mask: ArrayLike<number>, u: number, temperature = 1): number {
  if (temperature <= 0) return maskedArgmax(logits, mask);
  const top = logits[maskedArgmax(logits, mask)] ?? 0;
  const p: number[] = [];
  let sum = 0;
  for (let i = 0; i < logits.length; i++) {
    const e = mask[i] ? Math.exp((logits[i]! - top) / temperature) : 0;
    p.push(e);
    sum += e;
  }
  let acc = 0;
  for (let i = 0; i < p.length; i++) {
    acc += p[i]! / sum;
    if (mask[i] && u < acc) return i;
  }
  return maskedArgmax(logits, mask);
}

/**
 * The network's move for `seat`, or null when the game isn't waiting on it.
 * Greedy unless a temperature and a uniform `u` are given (randomness comes
 * from the caller, so core code stays deterministic). Confirming a hand
 * result and forced moves skip the network.
 */
export function netAction(s: MatchState, seat: number, net: HkNet, opts: { temperature?: number; u?: number } = {}): Action | null {
  const mask = legalMask(s, seat);
  const legal: number[] = [];
  mask.forEach((x, i) => x && legal.push(i));
  if (legal.length === 0) return null;
  if (mask[SLOT.ready]) return decodeSlot(s, seat, SLOT.ready);
  if (legal.length === 1) return decodeSlot(s, seat, legal[0]!);
  const { logits } = net.forward(observe(s, seat));
  const slot = opts.temperature && opts.u !== undefined ? sampleMasked(logits, mask, opts.u, opts.temperature) : maskedArgmax(logits, mask);
  return decodeSlot(s, seat, slot);
}
