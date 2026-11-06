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

export const NET_FORMAT = 'mahjong/hknet@2';

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

/** The planned size: 1.83M parameters, ~25M multiply-adds per decision. */
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

// ------------------------------------------------------------ the file
//
// A compact binary file (`.hknet`):
//   'HKN2' · u32 header length · header JSON (UTF-8) · zero padding to 4 · data
// The header lists every tensor's shape, storage type and byte offset in the
// data. Weights are stored as int8 with one float32 scale per output row
// (w ≈ q × scale, |q| ≤ 127) — a quarter of float32; the network computes in
// float32 after loading — or as float16 / float32. Biases stay float32.

export type DType = 'i8' | 'f16' | 'f32';

export interface TensorEntry {
  shape: number[];
  dtype: DType;
  offset: number;
  /** i8: byte offset of the float32 per-row scales. */
  scale?: number;
}

export interface NetHeader {
  format: typeof NET_FORMAT;
  encoderVersion: number;
  actionSpaceVersion: number;
  config: HkNetConfig;
  meta?: Record<string, unknown>;
  tensors: Record<string, TensorEntry>;
}

const MAGIC = 'HKN2';
const align4 = (n: number) => (n + 3) & ~3;

/** IEEE half → float. */
function halfToFloat(h: number): number {
  const sign = h & 0x8000 ? -1 : 1;
  const e = (h >> 10) & 0x1f;
  const f = h & 0x3ff;
  if (e === 0) return sign * f * 2 ** -24;
  if (e === 31) return f ? NaN : sign * Infinity;
  return sign * (1 + f / 1024) * 2 ** (e - 15);
}

/** Float → IEEE half, round to nearest even. */
function floatToHalf(x: number): number {
  const u = new Uint32Array(new Float32Array([x]).buffer)[0]!;
  const sign = (u >>> 16) & 0x8000;
  const e = (u >>> 23) & 0xff;
  let m = u & 0x7fffff;
  if (e === 255) return sign | 0x7c00 | (m ? 0x200 : 0);
  let he = e - 127 + 15;
  if (he >= 31) return sign | 0x7c00;
  if (he <= 0) {
    if (he < -10) return sign;
    m |= 0x800000;
    const shift = 14 - he;
    let hm = m >> shift;
    const rem = m & ((1 << shift) - 1);
    const half = 1 << (shift - 1);
    if (rem > half || (rem === half && hm & 1)) hm++;
    return sign | hm;
  }
  let hm = m >> 13;
  const rem = m & 0x1fff;
  if (rem > 0x1000 || (rem === 0x1000 && hm & 1)) {
    hm++;
    if (hm === 0x400) {
      hm = 0;
      he++;
      if (he >= 31) return sign | 0x7c00;
    }
  }
  return sign | (he << 10) | hm;
}

/** Write a network file; `weights` is the storage of every tensor with two or more dimensions. */
export function writeHkNet(
  head: Omit<NetHeader, 'format' | 'tensors'>,
  tensors: Record<string, { shape: number[]; data: Float32Array }>,
  weights: DType = 'i8',
): Uint8Array {
  const entries: Record<string, TensorEntry> = {};
  const chunks: { at: number; bytes: Uint8Array }[] = [];
  let at = 0;
  const put = (bytes: Uint8Array) => {
    const off = at;
    chunks.push({ at: off, bytes });
    at = align4(at + bytes.length);
    return off;
  };
  for (const [name, { shape, data }] of Object.entries(tensors)) {
    const dtype: DType = shape.length >= 2 ? weights : 'f32';
    if (dtype === 'f32') {
      entries[name] = { shape, dtype, offset: put(new Uint8Array(Float32Array.from(data).buffer)) };
    } else if (dtype === 'f16') {
      const h = new Uint16Array(data.length);
      data.forEach((x, i) => (h[i] = floatToHalf(x)));
      entries[name] = { shape, dtype, offset: put(new Uint8Array(h.buffer)) };
    } else {
      const rows = shape[0]!;
      const cols = data.length / rows;
      const q = new Int8Array(data.length);
      const scales = new Float32Array(rows);
      for (let r = 0; r < rows; r++) {
        let max = 0;
        for (let c = 0; c < cols; c++) max = Math.max(max, Math.abs(data[r * cols + c]!));
        const sc = max / 127;
        scales[r] = sc;
        for (let c = 0; c < cols; c++) q[r * cols + c] = sc > 0 ? Math.round(data[r * cols + c]! / sc) : 0;
      }
      const offset = put(new Uint8Array(q.buffer));
      entries[name] = { shape, dtype, offset, scale: put(new Uint8Array(scales.buffer)) };
    }
  }
  const header: NetHeader = { format: NET_FORMAT, ...head, tensors: entries };
  const json = new TextEncoder().encode(JSON.stringify(header));
  const start = align4(8 + json.length);
  const out = new Uint8Array(start + at);
  out.set(new TextEncoder().encode(MAGIC), 0);
  new DataView(out.buffer).setUint32(4, json.length, true);
  out.set(json, 8);
  for (const c of chunks) out.set(c.bytes, start + c.at);
  return out;
}

/** Read a network file: its header and every tensor as float32 (dequantised). */
export function readHkNet(file: Uint8Array | ArrayBuffer): { header: NetHeader; tensors: Record<string, Float32Array> } {
  const bytes = file instanceof Uint8Array ? file : new Uint8Array(file);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (new TextDecoder().decode(bytes.subarray(0, 4)) !== MAGIC) throw new Error('not an HK network file');
  const len = view.getUint32(4, true);
  const header = JSON.parse(new TextDecoder().decode(bytes.subarray(8, 8 + len))) as NetHeader;
  if (header.format !== NET_FORMAT) throw new Error(`unknown network format ${String(header.format)}`);
  const start = align4(8 + len);
  const tensors: Record<string, Float32Array> = {};
  for (const [name, t] of Object.entries(header.tensors)) {
    const size = t.shape.reduce((a, b) => a * b, 1);
    const base = start + t.offset;
    const out = new Float32Array(size);
    if (t.dtype === 'f32') for (let i = 0; i < size; i++) out[i] = view.getFloat32(base + 4 * i, true);
    else if (t.dtype === 'f16') for (let i = 0; i < size; i++) out[i] = halfToFloat(view.getUint16(base + 2 * i, true));
    else {
      const rows = t.shape[0]!;
      const cols = size / rows;
      const sbase = start + t.scale!;
      for (let r = 0; r < rows; r++) {
        const sc = view.getFloat32(sbase + 4 * r, true);
        for (let c = 0; c < cols; c++) out[r * cols + c] = view.getInt8(base + r * cols + c) * sc;
      }
    }
    tensors[name] = out;
  }
  return { header, tensors };
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

export function loadHkNet(bytes: Uint8Array | ArrayBuffer): HkNet {
  const { header: file, tensors } = readHkNet(bytes);
  if (file.encoderVersion !== ENCODER_VERSION) throw new Error(`network expects encoder v${file.encoderVersion}, this build has v${ENCODER_VERSION}`);
  if (file.actionSpaceVersion !== ACTION_SPACE_VERSION)
    throw new Error(`network expects action space v${file.actionSpaceVersion}, this build has v${ACTION_SPACE_VERSION}`);
  const c = file.config;
  if (c.planes !== NUM_PLANES || c.globals !== GLOBAL_DIM || c.slots !== NUM_SLOTS) throw new Error('network input / output sizes do not match this build');
  const W: Record<string, Float32Array> = {};
  for (const [name, shape] of Object.entries(tensorShapes(c))) {
    const t = file.tensors[name];
    const data = tensors[name];
    if (!t || !data) throw new Error(`missing tensor ${name}`);
    if (t.shape.join() !== shape.join()) throw new Error(`tensor ${name} should be [${shape.join(', ')}]`);
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
