// stdio bridge from HkVecEnv to the Python learner. Requests are JSON lines
// on stdin. Each reply is one JSON header line on stdout, followed by
// `bytes` bytes of binary payload. Diagnostics go to stderr.
//
//   → {"cmd":"spec"}                     ← header only: sizes, names, versions, the default net
//   → {"cmd":"reset","options":{…VecEnvOptions}}
//   → {"cmd":"step","actions":[slot, …]}  one per request of the last batch
//   ← {"ok":true,"n","env","seat","who","hint","reward","seq","done","episodes","finished","nnzTotal","aux","bytes"}
//      payload (little-endian, in this order):
//        val  f32 × nnzTotal     non-zero observation values, row after row
//        aux  f32 × n × auxDim   (only when aux is on)
//        danger f32 × n × dangerDim (only when danger is on)
//        idx  u16 × nnzTotal     their indices
//        nnz  u16 × n            non-zeros per row
//        mask u8  × n × numSlots
//   → {"cmd":"forward","path":"<net.hknet>","obs":"<b64 f32 n×obsDim>"}
//   ← {"ok":true,"logits":"<b64 f32 n×numSlots>","value":[…]}   the TS forward pass (export parity)
//   → {"cmd":"close"}
//   ← {"ok":false,"error":"…"}            on any failure

import { readFileSync } from 'node:fs';
import { createInterface } from 'node:readline';
import { ACTION_SPACE_VERSION, NUM_SLOTS, SLOT_NAMES } from '@/core/nn/hkActions';
import { ENCODER_VERSION, GLOBAL_DIM, KINDS, NUM_PLANES, OBS_DIM, featureLayout } from '@/core/nn/hkEncode';
import { DEFAULT_NET_CONFIG, NET_FORMAT, loadHkNet } from '@/core/nn/hkNet';
import { AUX_DIM, DANGER_DIM, HkVecEnv, type VecBatch, type VecEnvOptions } from './vec-env';

const bytesOf = (a: ArrayBufferView) => Buffer.from(a.buffer, a.byteOffset, a.byteLength);

function send(header: object, payload: Buffer[] = []): void {
  const bytes = payload.reduce((a, b) => a + b.length, 0);
  process.stdout.write(JSON.stringify({ ...header, bytes }) + '\n');
  for (const p of payload) if (p.length) process.stdout.write(p);
}

function sendBatch(b: VecBatch): void {
  send(
    {
      ok: true,
      n: b.n,
      env: b.env,
      seat: b.seat,
      who: b.who,
      hint: b.hint,
      reward: b.reward,
      seq: b.seq,
      done: b.done,
      episodes: b.episodes,
      finished: b.finished,
      nnzTotal: b.idx.length,
      aux: !!b.aux,
      danger: !!b.danger,
    },
    [bytesOf(b.val), ...(b.aux ? [bytesOf(b.aux)] : []), ...(b.danger ? [bytesOf(b.danger)] : []), bytesOf(b.idx), bytesOf(b.nnz), bytesOf(b.mask)],
  );
}

let env: HkVecEnv | null = null;

interface Request {
  cmd?: string;
  options?: Partial<VecEnvOptions>;
  actions?: number[];
  path?: string;
  obs?: string;
}

function handle(msg: Request): void {
  switch (msg.cmd) {
    case 'spec':
      return send({
        ok: true,
        obsDim: OBS_DIM,
        planes: NUM_PLANES,
        kinds: KINDS,
        globalDim: GLOBAL_DIM,
        numSlots: NUM_SLOTS,
        auxDim: AUX_DIM,
        dangerDim: DANGER_DIM,
        slotNames: SLOT_NAMES,
        featureLayout: featureLayout(),
        encoderVersion: ENCODER_VERSION,
        actionSpaceVersion: ACTION_SPACE_VERSION,
        netFormat: NET_FORMAT,
        defaultNet: DEFAULT_NET_CONFIG,
      });
    case 'reset':
      env = new HkVecEnv(msg.options ?? {});
      return sendBatch(env.reset());
    case 'step':
      if (!env) throw new Error('step before reset');
      if (!Array.isArray(msg.actions)) throw new Error('step needs "actions": number[]');
      return sendBatch(env.step(msg.actions));
    case 'forward': {
      if (!msg.path || !msg.obs) throw new Error('forward needs "path" and "obs"');
      const net = loadHkNet(readFileSync(msg.path));
      const b = Buffer.from(msg.obs, 'base64');
      const obs = new Float32Array(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength));
      const n = obs.length / OBS_DIM;
      const logits = new Float32Array(n * NUM_SLOTS);
      const value: number[] = [];
      for (let i = 0; i < n; i++) {
        const out = net.forward(obs.subarray(i * OBS_DIM, (i + 1) * OBS_DIM));
        logits.set(out.logits, i * NUM_SLOTS);
        value.push(out.value);
      }
      return send({ ok: true, logits: bytesOf(logits).toString('base64'), value });
    }
    case 'close':
      process.exit(0);
    default:
      throw new Error(`unknown cmd ${JSON.stringify(msg.cmd)}`);
  }
}

// The learner went away mid-reply: nothing left to do.
process.stdout.on('error', () => process.exit(0));

createInterface({ input: process.stdin, crlfDelay: Infinity }).on('line', (line) => {
  if (!line.trim()) return;
  try {
    handle(JSON.parse(line) as Request);
  } catch (e) {
    send({ ok: false, error: (e as Error).stack ?? (e as Error).message });
  }
});
