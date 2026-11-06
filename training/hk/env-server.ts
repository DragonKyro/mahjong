// stdio bridge from HkVecEnv to the Python learner. One JSON object per line
// in, one per line out, strictly request / response; diagnostics go to stderr.
//
//   → {"cmd":"spec"}
//   ← {"ok":true,"obsDim","planes","kinds","globalDim","numSlots","auxDim",
//      "slotNames","featureLayout","encoderVersion","actionSpaceVersion","netFormat","defaultNet"}
//   → {"cmd":"reset","options":{numEnvs, seed, seats, rewardScale, rankReward, rules, autoForced, aux, maxActions}}
//   → {"cmd":"step","actions":[slot, …]}            one per request of the last batch
//   ← {"ok":true,"n","env":[…],"seat":[…],"who":[…],"obs":"<b64 f32 n×obsDim>",
//      "mask":"<b64 u8 n×numSlots>","reward":[…],"aux":"<b64 f32 n×auxDim>"|null,
//      "done":[{env,seat,who,reward}],"episodes":[{env,match,seed,who,scores,hands,actions,truncated}]}
//   → {"cmd":"forward","path":"<net.json>","obs":"<b64 f32 n×obsDim>"}
//   ← {"ok":true,"logits":"<b64 f32 n×numSlots>","value":[…]}   (the TS forward pass, for export parity)
//   → {"cmd":"close"}
//   ← {"ok":false,"error":"…"}                         on any failure

import { readFileSync } from 'node:fs';
import { createInterface } from 'node:readline';
import { ACTION_SPACE_VERSION, NUM_SLOTS, SLOT_NAMES } from '@/core/nn/hkActions';
import { ENCODER_VERSION, GLOBAL_DIM, KINDS, NUM_PLANES, OBS_DIM, featureLayout } from '@/core/nn/hkEncode';
import { DEFAULT_NET_CONFIG, NET_FORMAT, loadHkNet, type HkNetFile } from '@/core/nn/hkNet';
import { AUX_DIM, HkVecEnv, type VecBatch, type VecEnvOptions } from './vec-env';

const b64 = (a: ArrayBufferView) => Buffer.from(a.buffer, a.byteOffset, a.byteLength).toString('base64');
const f32 = (s: string) => {
  const b = Buffer.from(s, 'base64');
  return new Float32Array(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength));
};

function batchReply(b: VecBatch) {
  return {
    ok: true,
    n: b.env.length,
    env: b.env,
    seat: b.seat,
    who: b.who,
    obs: b64(b.obs),
    mask: b64(b.mask),
    reward: b.reward,
    aux: b.aux ? b64(b.aux) : null,
    done: b.done,
    episodes: b.episodes,
  };
}

let env: HkVecEnv | null = null;

interface Request {
  cmd?: string;
  options?: Partial<VecEnvOptions>;
  actions?: number[];
  path?: string;
  obs?: string;
}

function handle(msg: Request): object {
  switch (msg.cmd) {
    case 'spec':
      return {
        ok: true,
        obsDim: OBS_DIM,
        planes: NUM_PLANES,
        kinds: KINDS,
        globalDim: GLOBAL_DIM,
        numSlots: NUM_SLOTS,
        auxDim: AUX_DIM,
        slotNames: SLOT_NAMES,
        featureLayout: featureLayout(),
        encoderVersion: ENCODER_VERSION,
        actionSpaceVersion: ACTION_SPACE_VERSION,
        netFormat: NET_FORMAT,
        defaultNet: DEFAULT_NET_CONFIG,
      };
    case 'reset':
      env = new HkVecEnv(msg.options ?? {});
      return batchReply(env.reset());
    case 'step':
      if (!env) throw new Error('step before reset');
      if (!Array.isArray(msg.actions)) throw new Error('step needs "actions": number[]');
      return batchReply(env.step(msg.actions));
    case 'forward': {
      if (!msg.path || !msg.obs) throw new Error('forward needs "path" and "obs"');
      const net = loadHkNet(JSON.parse(readFileSync(msg.path, 'utf8')) as HkNetFile);
      const obs = f32(msg.obs);
      const n = obs.length / OBS_DIM;
      const logits = new Float32Array(n * NUM_SLOTS);
      const value: number[] = [];
      for (let i = 0; i < n; i++) {
        const out = net.forward(obs.subarray(i * OBS_DIM, (i + 1) * OBS_DIM));
        logits.set(out.logits, i * NUM_SLOTS);
        value.push(out.value);
      }
      return { ok: true, logits: b64(logits), value };
    }
    case 'close':
      process.exit(0);
    default:
      throw new Error(`unknown cmd ${JSON.stringify(msg.cmd)}`);
  }
}

createInterface({ input: process.stdin, crlfDelay: Infinity }).on('line', (line) => {
  if (!line.trim()) return;
  let reply: object;
  try {
    reply = handle(JSON.parse(line) as Request);
  } catch (e) {
    reply = { ok: false, error: (e as Error).message };
  }
  process.stdout.write(JSON.stringify(reply) + '\n');
});
