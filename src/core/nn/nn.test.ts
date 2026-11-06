import { describe, expect, it } from 'vitest';
import { chooseAction } from '../ai';
import { createMatch, createRiggedMatch, pendingSeats, tryApply, applyAction, type Action, type Claim, type MatchConfig, type MatchState } from '../engine';
import { Rng } from '../rng';
import { isBonus, kindOf, parseKinds, type Kind } from '../tiles';
import { DEFAULT_HK_RULES } from '../variants/hk';
import { ACTION_SPACE_VERSION, NUM_SLOTS, SLOT, SLOT_NAMES, decodeSlot, legalMask, slotOf } from './hkActions';
import { ENCODER_VERSION, GLOBAL_DIM, KINDS, NUM_PLANES, OBS_DIM, encode, featureLayout, observe, seatView } from './hkEncode';
import { DEFAULT_NET_CONFIG, loadHkNet, netAction, readHkNet, tensorShapes, writeHkNet, type DType, type HkNetConfig } from './hkNet';

const config = (seed: number, over: Partial<MatchConfig> = {}): MatchConfig => ({
  variant: 'hk',
  rules: DEFAULT_HK_RULES,
  seats: [0, 1, 2, 3].map((i) => ({ name: `P${i}`, ai: true, level: 'normal' as const })),
  seed,
  ...over,
});

/** States from heuristic-AI matches (every `every`th action). */
function sampleStates(seeds: number[], every: number, cap = 900): MatchState[] {
  const out: MatchState[] = [];
  for (const seed of seeds) {
    let s = createMatch(config(seed));
    for (let n = 0; !s.over && n < cap; n++) {
      if (n % every === 0) out.push(s);
      s = applyAction(s, chooseAction(s, pendingSeats(s)[0]!)!);
    }
  }
  return out;
}
const STATES = sampleStates([11, 12], 3);

/** Shuffle everything `seat` can't see: the other hands, the unseen wall, the others' claim answers. */
function scramble(s: MatchState, seat: number, rng: Rng): MatchState {
  const x = JSON.parse(JSON.stringify(s)) as MatchState;
  const h = x.hand;
  const slots: { arr: number[]; i: number }[] = [];
  h.players.forEach((p, o) => o !== seat && p.hand.forEach((_, i) => slots.push({ arr: p.hand, i })));
  for (let i = h.head; i < h.tail; i++) if (!isBonus(kindOf(h.wall[i]!))) slots.push({ arr: h.wall, i });
  const drawnAt = h.drawn !== null && h.turn !== seat ? h.players[h.turn]!.hand.indexOf(h.drawn) : -1;
  const ids = rng.shuffle(slots.map(({ arr, i }) => arr[i]!));
  slots.forEach(({ arr, i }, j) => (arr[i] = ids[j]!));
  if (drawnAt >= 0) h.drawn = h.players[h.turn]!.hand[drawnAt]!;
  if (h.claim) {
    h.claim.responses = h.claim.responses.map((r, o) => (o === seat ? r : rng.next() < 0.5 ? null : { type: 'pass' }));
    h.claim.options = h.claim.options.map((o, i) => (i === seat ? o : rng.next() < 0.5 ? [] : [{ type: 'pong' }, { type: 'win' }]));
  }
  return x;
}

/** Every action the engine accepts from `seat`, found by brute force. */
function engineLegal(s: MatchState, seat: number): Action[] {
  const h = s.hand;
  const cands: Action[] = [];
  if (h.phase === 'act' && h.turn === seat) {
    for (const tile of h.players[seat]!.hand) cands.push({ type: 'discard', seat, tile });
    for (let kind = 0; kind < 34; kind++) cands.push({ type: 'kong', seat, kind });
    cands.push({ type: 'win', seat });
  } else if (h.phase === 'claim' && h.claim) {
    const k = kindOf(h.claim.tile);
    const claims: Claim[] = [{ type: 'pass' }, { type: 'win' }, { type: 'pong' }, { type: 'kong' }, ...[k - 2, k - 1, k].map((low): Claim => ({ type: 'chi', low }))];
    for (const claim of claims) cands.push({ type: 'claim', seat, claim });
  } else if (h.phase === 'end') {
    cands.push({ type: 'ready', seat });
  }
  return cands.filter((a) => tryApply(s, a) !== null);
}

describe('HK action space', () => {
  it('names every slot', () => {
    expect(SLOT_NAMES).toHaveLength(NUM_SLOTS);
    expect(new Set(SLOT_NAMES).size).toBe(NUM_SLOTS);
  });

  it('the mask is exactly what the engine accepts, and every legal slot decodes to a legal action', () => {
    expect(STATES.length).toBeGreaterThan(200);
    const seen = new Set<number>();
    for (const s of STATES) {
      for (let seat = 0; seat < 4; seat++) {
        const mask = legalMask(s, seat);
        const fromEngine = new Set(engineLegal(s, seat).map((a) => slotOf(s, a)));
        const fromMask = new Set([...mask.keys()].filter((i) => mask[i]));
        expect([...fromMask].sort((a, b) => a - b)).toEqual([...fromEngine].sort((a, b) => a - b));
        for (const slot of fromMask) {
          const a = decodeSlot(s, seat, slot);
          expect(tryApply(s, a), `${SLOT_NAMES[slot]} for seat ${seat}`).not.toBeNull();
          expect(slotOf(s, a)).toBe(slot);
          seen.add(slot);
        }
        if (fromMask.size > 0) expect(pendingSeats(s)).toContain(seat);
      }
    }
    // The sample exercises discards, 摸切, claims and the end of a hand.
    for (const slot of [SLOT.tsumogiri, SLOT.pass, SLOT.pong, SLOT.ready]) expect(seen.has(slot), SLOT_NAMES[slot]).toBe(true);
  });

  it('chow slots follow where the discard sits in the run', () => {
    // Seat 0 deals and throws 3m; seat 1 holds 12m 45m: 123 (3m high), 234 (middle), 345 (low).
    const hands = ['3m 2p 5p 8p 2s 5s 8s 1z 2z 3z 4z 5z 6z', '12m 45m 3p 6p 9p 3s 6s 9s 1z 2z 3z', '33m 1p 4p 7p 1s 4s 7s 789m 6z 7z', '12m 6m 2p 3p 4p 2s 3s 4s 5z 5z 6z 7z'];
    let s = createRiggedMatch(config(1), { dealer: 0, front: front(hands, 0, '7z') });
    const m0 = legalMask(s, 0);
    expect(m0[SLOT.tsumogiri]).toBe(1); // the drawn 7z is the only one
    expect(m0[SLOT.discard + 33]).toBe(0);
    expect(m0[SLOT.discard + 2]).toBe(1);
    s = applyAction(s, decodeSlot(s, 0, SLOT.discard + 2));
    const m1 = legalMask(s, 1);
    expect([0, 1, 2].map((d) => m1[SLOT.chi + d])).toEqual([1, 1, 1]);
    expect(decodeSlot(s, 1, SLOT.chi)).toMatchObject({ claim: { type: 'chi', low: 2 } });
    expect(decodeSlot(s, 1, SLOT.chi + 2)).toMatchObject({ claim: { type: 'chi', low: 0 } });
    expect(legalMask(s, 2)[SLOT.pong]).toBe(1);
    expect(legalMask(s, 3).every((x) => x === 0)).toBe(true);
  });
});

/** Wall front for a rigged deal (as in engine.test.ts). */
function front(hands: string[], dealer: number, dealerDraw: string, draws = ''): Kind[] {
  const h = hands.map(parseKinds);
  const order = [0, 1, 2, 3].map((i) => (dealer + i) % 4);
  const out: Kind[] = [];
  for (let r = 0; r < 3; r++) for (const seat of order) out.push(...h[seat]!.slice(r * 4, r * 4 + 4));
  for (const seat of order) out.push(h[seat]![12]!);
  return [...out, ...parseKinds(dealerDraw), ...parseKinds(draws)];
}

describe('HK encoding', () => {
  it('has a consistent, named layout', () => {
    const { planes, globals } = featureLayout();
    expect(planes).toHaveLength(NUM_PLANES);
    expect(globals).toHaveLength(GLOBAL_DIM);
    expect(new Set([...planes, ...globals]).size).toBe(NUM_PLANES + GLOBAL_DIM);
    expect(OBS_DIM).toBe(NUM_PLANES * KINDS + GLOBAL_DIM);
  });

  it('sees nothing hidden: scrambling other hands, the wall and others’ claim answers changes nothing', () => {
    const rng = new Rng(5);
    let differ = 0;
    for (const s of STATES) {
      for (let seat = 0; seat < 4; seat++) {
        const a = seatView(s, seat);
        const b = seatView(scramble(s, seat, rng), seat);
        if (JSON.stringify(a) !== JSON.stringify(b)) expect(b).toEqual(a);
        const [x, y] = [encode(a), encode(b)];
        if (x.some((v, i) => v !== y[i])) differ++;
      }
    }
    expect(differ).toBe(0);
  });

  it('encodes values in a sane range', () => {
    for (const s of STATES.slice(0, 80)) {
      const x = observe(s, pendingSeats(s)[0]!);
      expect(x).toHaveLength(OBS_DIM);
      expect(x.findIndex((v) => !(Number.isFinite(v) && v >= -4 && v <= 4))).toBe(-1);
    }
  });

  it('reads the hand, the waits and what a win would score', () => {
    // Seat 1 waits on 2p / 5p (123m 456m 789s 34p 66s); the dealer throws 5p: 地糊.
    const hands = ['5p 9p 2s 5s 8s 1z 2z 3z 4z 5z 6z 7z 9m', '123m 456m 789s 34p 66s', '1z 2z 3z 4z 5z 6z 7z 1z 2z 3z 4z 5z 6z', '234m 567m 123s 46p 99s'];
    let s = createRiggedMatch(config(1), { dealer: 0, front: front(hands, 0, '9s') });
    s = applyAction(s, decodeSlot(s, 0, SLOT.discard + 13));
    const x = observe(s, 1);
    const { planes, globals } = featureLayout();
    const P = (name: string, k: number) => x[planes.indexOf(name) * KINDS + k]!;
    const G = (name: string) => x[NUM_PLANES * KINDS + globals.indexOf(name)]!;
    expect(P('hand.>=1', 0)).toBe(1);
    expect(P('hand.>=2', 23)).toBe(1); // 66s
    expect(P('claimTile', 13)).toBe(1);
    expect(P('wait', 10)).toBe(1);
    expect(P('wait', 13)).toBe(1);
    expect(P('wait', 12)).toBe(0);
    expect(P('ronFaan', 13)).toBe(1); // 地糊, a limit hand → the 10-faan cap
    expect(G('ronNow.faan')).toBe(1);
    expect(G('shanten.0')).toBe(1);
    expect(G(`legal.${SLOT.ron}`)).toBe(1);
    expect(G('claimFrom.prev')).toBe(1);
    expect(G('dealer.prev')).toBe(1);
    expect(G('seatWind.S')).toBe(1);
    expect(P('prev.lastDiscard', 13)).toBe(1);
    expect(P('prev.discardSeq.0', 13)).toBe(1);
  });
});

function randomTensors(c: HkNetConfig, seed: number) {
  const rng = new Rng(seed);
  const tensors: Record<string, { shape: number[]; data: Float32Array }> = {};
  for (const [name, shape] of Object.entries(tensorShapes(c))) {
    tensors[name] = { shape, data: new Float32Array(shape.reduce((x, y) => x * y, 1)).map(() => (rng.next() - 0.5) * 0.2) };
  }
  return tensors;
}

function randomNet(c: HkNetConfig, seed: number, versions = { e: ENCODER_VERSION, a: ACTION_SPACE_VERSION }, weights: DType = 'i8'): Uint8Array {
  return writeHkNet({ encoderVersion: versions.e, actionSpaceVersion: versions.a, config: c }, randomTensors(c, seed), weights);
}

const TINY: HkNetConfig = { ...DEFAULT_NET_CONFIG, channels: 8, blocks: 1, neck: 4, globalHidden: 16, hidden: 32, valueHidden: 8 };

describe('HK network runtime', () => {
  it('stores weights compactly and reads them back', () => {
    const t = randomTensors(TINY, 9);
    const head = { encoderVersion: ENCODER_VERSION, actionSpaceVersion: ACTION_SPACE_VERSION, config: TINY };
    const sizes: Record<string, number> = {};
    for (const [dtype, tol] of [['f32', 0], ['f16', 1e-4], ['i8', 0.1 / 127 / 2 + 1e-7]] as const) {
      const bytes = writeHkNet(head, t, dtype);
      sizes[dtype] = bytes.length;
      const back = readHkNet(bytes).tensors;
      for (const [name, { data }] of Object.entries(t)) {
        const got = back[name]!;
        let worst = 0;
        data.forEach((x, i) => (worst = Math.max(worst, Math.abs(x - got[i]!))));
        expect(worst, `${dtype} ${name}`).toBeLessThanOrEqual(tol);
      }
    }
    const full = randomTensors(DEFAULT_NET_CONFIG, 1);
    const big = { ...head, config: DEFAULT_NET_CONFIG };
    const [i8, f32] = [writeHkNet(big, full, 'i8').length, writeHkNet(big, full, 'f32').length];
    expect(i8 / f32).toBeLessThan(0.26); // int8 + per-row scales ≈ a quarter of float32
    expect(i8).toBeLessThan(1.9e6);
  });

  it('refuses a network built for another encoder or action space', () => {
    expect(() => loadHkNet(randomNet(TINY, 1, { e: ENCODER_VERSION + 1, a: ACTION_SPACE_VERSION }))).toThrow(/encoder/);
    expect(() => loadHkNet(randomNet(TINY, 1, { e: ENCODER_VERSION, a: ACTION_SPACE_VERSION + 1 }))).toThrow(/action space/);
  });

  it('runs the planned size', () => {
    const net = loadHkNet(randomNet(DEFAULT_NET_CONFIG, 2));
    const out = net.forward(observe(STATES[5]!, pendingSeats(STATES[5]!)[0]!));
    expect(out.logits).toHaveLength(NUM_SLOTS);
    expect(out.logits.every(Number.isFinite) && Number.isFinite(out.value)).toBe(true);
  });

  it('plays legally hand after hand', () => {
    const net = loadHkNet(randomNet(TINY, 3));
    let s = createMatch(config(21, { seats: [0, 1, 2, 3].map((i) => ({ name: `N${i}`, ai: true })) }));
    const rng = new Rng(4);
    // applyAction throws on an illegal move. (An untrained net mostly plays to
    // drawn hands and the dealer keeps the deal, so don't wait for the match end.)
    while (!s.over && s.history.length < 3) {
      const seat = pendingSeats(s)[0]!;
      s = applyAction(s, netAction(s, seat, net, { temperature: 1, u: rng.next() })!);
    }
    expect(s.history.length).toBe(3);
  });
});
