// The HK network's input: everything one seat can see, encoded as 34-wide
// tile planes (one value per tile kind, so a 1-D convolution can read shapes
// across neighbouring kinds) plus a global vector.
//
// Two steps keep hidden information out by construction:
//   seatView(state, seat) copies only what that seat may know — its own
//     concealed tiles and drawn tile, and the public table: every player's
//     melds (concealed kongs show their kind), bonus tiles, discards in order
//     (with 摸切 and called flags), concealed tile counts, scores, winds, the
//     wall count, the claim on offer, and the rules. Never the wall order,
//     another hand, another seat's drawn tile or another seat's claim answer.
//   encode(view) turns the view into numbers. It also adds features derived
//     from the view alone — shanten, acceptance per discard, waits, the faan a
//     win would score, the shanten after each call — which the network could
//     in principle learn but which cost a lot of training to rediscover.
//
// All seats are relative to the viewer: 0 me, 1 下家 (next, to my right),
// 2 對家 (across), 3 上家 (left; the only seat I may chow from).
//
// Layout: [planes: NUM_PLANES × 34 row-major][globals: GLOBAL_DIM].

import { claimOptions, liveLeft, seatWind, blankWinInput, type HandState, type MatchState } from '../engine';
import { analyzeDiscards, shanten, waits, type ShapeOptions } from '../hand';
import { BONUS0, DRAGON0, WIND0, kindOf, type Kind } from '../tiles';
import { getVariant } from '../variants';
import { FAAN_TABLE, evaluateHk, tablePoints, type HkRules } from '../variants/hk';
import { NUM_SLOTS, SLOT, legalMask } from './hkActions';

/** Bump whenever the layout or meaning of any feature changes. */
export const ENCODER_VERSION = 1;

export const KINDS = 34;
/** Discards per player in the sequence planes (most recent first; older ones still count in the totals). */
export const SEQ = 24;
export const MAX_MELDS = 4;
/** Live tiles after the deal (144 − 53), before flower replacements. */
const LIVE0 = 91;

// ------------------------------------------------------------ the seat view

export interface DiscardView {
  kind: Kind;
  /** 摸切: the tile thrown was the one just drawn. */
  tsumogiri: boolean;
  /** Claimed by another player (it sits in their meld now). */
  called: boolean;
  /** Index of this discard among all the table's discards this hand. */
  time: number;
}

export interface MeldView {
  type: 'chi' | 'pong' | 'kong';
  /** Pong / kong kind, or the chow's lowest kind. */
  kind: Kind;
  kinds: Kind[];
  concealed: boolean;
  added: boolean;
  /** Relative seat that fed it (null for a concealed kong). */
  from: number | null;
  /** Kind of the claimed tile. */
  claimed: Kind | null;
  /** Table discards made before it was declared. */
  time: number;
}

export interface PlayerView {
  melds: MeldView[];
  bonus: Kind[];
  discards: DiscardView[];
  /** Concealed tiles held (the count is public). */
  concealed: number;
  /** Discards made this hand. */
  played: number;
}

export interface SeatView {
  seat: number;
  rules: HkRules;
  /** Relative seats from here on. */
  scores: number[];
  seatWind: number;
  prevailing: number;
  dealer: number;
  streak: number;
  passes: number;
  handNo: number;
  phase: 'act' | 'claim' | 'end';
  turn: number;
  drawKind: HandState['drawKind'];
  kongChain: number;
  liveLeft: number;
  /** Tiles drawn from the back of the wall (flower and kong replacements). */
  backDraws: number;
  /** Discards on the table so far this hand. */
  discards: number;
  calls: number;
  /** My concealed kinds (the drawn tile included). */
  hand: Kind[];
  /** The tile I just drew, on my turn. */
  drawn: Kind | null;
  players: PlayerView[];
  claim: { kind: 'discard' | 'robKong'; tile: Kind; from: number; asked: boolean } | null;
  /** Legal action slots for me (see hkActions). */
  mask: number[];
}

export function seatView(s: MatchState, seat: number): SeatView {
  if (s.config.variant !== 'hk') throw new Error('the HK network plays Hong Kong Old Style only');
  const h = s.hand;
  if (h.phase === 'charleston') throw new Error('no Charleston in HK');
  const rel = (x: number) => (x - seat + 4) % 4;

  // The public timeline: discard order, 摸切 flags, when each meld was made.
  const timeline: { seat: number; tile: number; tsumogiri: boolean; time: number }[] = [];
  const meldTimes: number[][] = [[], [], [], []];
  let now = 0;
  for (const e of h.log) {
    if (e.t === 'discard') timeline.push({ seat: e.seat, tile: e.tile, tsumogiri: !!e.tsumogiri, time: now++ });
    else if (e.t === 'chi' || e.t === 'pong' || (e.t === 'kong' && e.how !== 'added')) meldTimes[e.seat]!.push(now);
  }

  const players: PlayerView[] = [];
  for (let r = 0; r < 4; r++) {
    const i = (seat + r) % 4;
    const p = h.players[i]!;
    const pond = new Set(p.discards);
    players.push({
      melds: p.melds.map((m, j) => ({
        type: m.type === 'set' ? 'pong' : m.type,
        kind: m.kind,
        kinds: m.tiles.map(kindOf),
        concealed: m.concealed,
        added: !!m.added,
        from: m.from === null ? null : rel(m.from),
        claimed: m.claimed === null ? null : kindOf(m.claimed),
        time: meldTimes[i]![j] ?? now,
      })),
      bonus: p.bonus.map(kindOf),
      discards: timeline
        .filter((d) => d.seat === i)
        .map((d) => ({ kind: kindOf(d.tile), tsumogiri: d.tsumogiri, called: !pond.has(d.tile), time: d.time })),
      concealed: p.hand.length,
      played: h.played[i]!,
    });
  }

  const me = h.players[seat]!;
  return {
    seat,
    rules: s.config.rules as HkRules,
    scores: [0, 1, 2, 3].map((r) => s.scores[(seat + r) % 4]!),
    seatWind: seatWind(s, seat),
    prevailing: s.prevailing,
    dealer: rel(s.dealer),
    streak: s.streak,
    passes: s.passes,
    handNo: s.handNo,
    phase: h.phase,
    turn: rel(h.turn),
    drawKind: h.drawKind,
    kongChain: h.kongChain,
    liveLeft: liveLeft(s),
    backDraws: h.wall.length - h.tail,
    discards: h.discards,
    calls: h.calls,
    hand: me.hand.map(kindOf),
    drawn: h.phase === 'act' && h.turn === seat && h.drawn !== null ? kindOf(h.drawn) : null,
    players,
    claim:
      h.phase === 'claim' && h.claim
        ? { kind: h.claim.kind, tile: kindOf(h.claim.tile), from: rel(h.claim.from), asked: claimOptions(s, seat).length > 0 }
        : null,
    mask: Array.from(legalMask(s, seat)),
  };
}

// ------------------------------------------------------------ the layout

const planeNames: string[] = [];
const globalNames: string[] = [];
const block = (names: string[], name: string, labels: readonly (string | number)[] | null): number => {
  const at = names.length;
  if (!labels) names.push(name);
  else for (const l of labels) names.push(`${name}.${l}`);
  return at;
};
const plane = (name: string, labels: readonly (string | number)[] | null = null) => block(planeNames, name, labels);
const glob = (name: string, labels: readonly (string | number)[] | null = null) => block(globalNames, name, labels);
const range = (n: number) => Array.from({ length: n }, (_, i) => i);
const GE = ['>=1', '>=2', '>=3', '>=4'];
const REL = ['me', 'next', 'across', 'prev'];

const PL = {
  hand: plane('hand', GE),
  drawn: plane('drawn'),
  claim: plane('claimTile'),
  unseen: plane('unseen', GE),
  /** Faan a pong of the kind is worth to each seat (dragons, its seat wind, the round wind) / 4. */
  value: plane('valueFor', REL),
  seats: REL.map((who) => ({
    meld: plane(`${who}.meldTiles`, GE),
    pong: plane(`${who}.pong`),
    kongExposed: plane(`${who}.kongExposed`),
    kongConcealed: plane(`${who}.kongConcealed`),
    kongAdded: plane(`${who}.kongAdded`),
    chiLow: plane(`${who}.chiLow`),
    claimed: plane(`${who}.claimedTile`),
    gone: plane(`${who}.discarded`, GE),
    pond: plane(`${who}.pond`),
    tsumogiri: plane(`${who}.tsumogiri`),
    last: plane(`${who}.lastDiscard`),
    meldSlot: plane(`${who}.meldSlot`, range(MAX_MELDS)),
    seq: plane(`${who}.discardSeq`, range(SEQ)),
  })),
  // Derived from my own tiles and what I can see.
  wait: plane('wait'),
  ronFaan: plane('ronFaan'),
  tsumoFaan: plane('tsumoFaan'),
  improve: plane('improve'),
  discardShanten: plane('discardShanten'),
  discardBest: plane('discardBest'),
  discardAccept: plane('discardAccept'),
};

const SHANTEN_BINS = ['-1', '0', '1', '2', '3', '4', '5', '6+'];
const GL = {
  seatWind: glob('seatWind', ['E', 'S', 'W', 'N']),
  prevailing: glob('prevailing', ['E', 'S', 'W', 'N']),
  dealer: glob('dealer', REL),
  passInRound: glob('handOfRound', range(4)),
  handsLeft: glob('handsLeft'),
  allLast: glob('allLast'),
  handNo: glob('handNo'),
  streak: glob('streak', ['0', '1', '2', '3', '4+']),
  streakScaled: glob('streakScaled'),
  score: glob('score', REL),
  rank: REL.map((who) => glob(`${who}.rank`, range(4))),
  lead: glob('leadOver', REL.slice(1)),
  phase: glob('phase', ['act', 'claim', 'end']),
  turn: glob('turn', REL),
  drawKind: glob('drawKind', ['deal', 'wall', 'replacement', 'claim']),
  kongChain: glob('kongChain'),
  claimOn: glob('claim'),
  claimRob: glob('claimRobKong'),
  claimFrom: glob('claimFrom', REL),
  claimAsked: glob('claimAsked'),
  mask: glob('legal', range(NUM_SLOTS)),
  live: glob('liveLeft'),
  liveZero: glob('lastTile'),
  liveFive: glob('liveLeft<=5'),
  backDraws: glob('backDraws'),
  discards: glob('tableDiscards'),
  calls: glob('calls'),
  noCalls: glob('noCallsYet'),
  seats: REL.map((who) => ({
    played: glob(`${who}.played`),
    concealed: glob(`${who}.concealedTiles`),
    melds: glob(`${who}.melds`),
    open: glob(`${who}.open`),
    concealedKongs: glob(`${who}.concealedKongs`),
    bonusCount: glob(`${who}.bonusCount`),
    seatBonus: glob(`${who}.seatBonus`),
    flowerSet: glob(`${who}.flowerSet`, ['flowers', 'seasons']),
    bonus: glob(`${who}.bonus`, ['梅', '蘭', '菊', '竹', '春', '夏', '秋', '冬']),
    meldMeta: range(MAX_MELDS).map((j) =>
      glob(`${who}.meld${j}`, ['present', 'chi', 'pong', 'kongExposed', 'kongConcealed', 'kongAdded', 'fromMe', 'fromNext', 'fromAcross', 'fromPrev', 'time']),
    ),
    discardMeta: range(SEQ).map((j) => glob(`${who}.discard${j}`, ['present', 'tsumogiri', 'called', 'age', 'time'])),
  })),
  rules: glob('rules', [
    'minFaan',
    'maxFaan',
    'fullSpicy',
    'fullGun',
    'liability',
    'sevenPairs',
    'flowerHands',
    'multiWin',
    'dealerStaysOnDraw',
    'robConcealedKong',
    'rounds1',
    'rounds2',
    'rounds4',
    'startingScore',
  ]),
  faan: glob('faan', FAAN_TABLE.map((e) => e.id)),
  shanten: glob('shanten', SHANTEN_BINS),
  waits: glob('waitKinds'),
  waitsLeft: glob('waitTilesLeft'),
  canWinOnWait: glob('readyWithFaan'),
  bestRonFaan: glob('bestRonFaan'),
  bestTsumoFaan: glob('bestTsumoFaan'),
  bestRonPoints: glob('bestRonPoints'),
  ronNow: glob('ronNow', ['faan', 'points']),
  tsumoNow: glob('tsumoNow', ['faan', 'points']),
  callShanten: glob('shantenAfter', ['pong', 'kong', 'chiLow', 'chiMiddle', 'chiHigh']),
  bestDiscardAccept: glob('bestDiscardAccept'),
};

export const NUM_PLANES = planeNames.length;
export const GLOBAL_DIM = globalNames.length;
export const OBS_DIM = NUM_PLANES * KINDS + GLOBAL_DIM;

/** Feature names in order: the planes first (each 34 wide), then the globals. */
export function featureLayout(): { planes: string[]; globals: string[] } {
  return { planes: [...planeNames], globals: [...globalNames] };
}

// ------------------------------------------------------------ encoding

interface Hypothetical {
  faan: number;
  points: number;
}

/** What a win on `tile` would score, or null when it isn't a legal win. */
function wouldWin(v: SeatView, tile: Kind, selfDraw: boolean, from: number | null, robbingKong = false): Hypothetical | null {
  const me = v.players[0]!;
  // Situational faan only for the tile actually in play (the drawn tile, the discard on offer).
  const live = selfDraw ? v.drawn !== null : v.claim?.tile === tile;
  const noCalls = v.calls === 0 && me.played === 0;
  const input = blankWinInput({
    seat: 0,
    seatWind: v.seatWind,
    prevailing: v.prevailing,
    dealer: v.dealer,
    concealed: selfDraw && v.drawn !== null ? v.hand : [...v.hand, tile],
    winTile: tile,
    melds: me.melds.map((m, i) => ({ type: m.type, kind: m.kind, concealed: m.concealed, from: m.from, order: i, tiles: m.kinds.map((k) => k * 4) })),
    bonus: me.bonus,
    selfDraw,
    from: selfDraw ? null : from,
    robbingKong: live && robbingKong,
    lastTile: live && v.liveLeft === 0,
    kongReplacement: live && selfDraw && v.drawKind === 'replacement' ? v.kongChain : 0,
    firstDraw: live && selfDraw && noCalls && (v.drawKind === 'deal' || v.drawKind === 'wall'),
    dealersFirstDiscard: live && !selfDraw && from === v.dealer && v.discards === 1 && v.calls === 0,
    wallLeft: v.liveLeft,
    streak: v.streak,
  });
  const score = evaluateHk(input, v.rules);
  if (!score || !getVariant('hk').canWin(score, v.rules)) return null;
  return { faan: score.value, points: tablePoints(score.value, v.rules) };
}

const shantenBin = (s: number) => Math.min(7, Math.max(0, s + 1));

/** The lowest shanten after taking a call (removing `use` from the hand) and discarding the best tile. */
function shantenAfterCall(c: number[], use: Kind[], sets: number, opts: ShapeOptions): number {
  const x = c.slice();
  for (const k of use) {
    if (!x[k]) return 99;
    x[k]!--;
  }
  let best = 99;
  for (let k = 0; k < KINDS; k++) {
    if (!x[k]) continue;
    x[k]!--;
    best = Math.min(best, shanten(x, sets - 1, opts));
    x[k]!++;
  }
  return best;
}

export function encode(v: SeatView): Float32Array {
  const out = new Float32Array(OBS_DIM);
  const G = NUM_PLANES * KINDS;
  const setP = (ch: number, k: number, x: number) => (out[ch * KINDS + k] = x);
  const addP = (ch: number, k: number, x: number) => (out[ch * KINDS + k]! += x);
  const setG = (i: number, x: number) => (out[G + i] = x);
  const therm = (ch: number, counts: readonly number[]) => {
    for (let k = 0; k < KINDS; k++) for (let i = 0; i < 4; i++) if (counts[k]! > i) setP(ch + i, k, 1);
  };
  const rules = v.rules;
  const maxF = Math.max(1, rules.maxFaan);
  const maxPts = tablePoints(rules.maxFaan, rules);

  // ---- my tiles and what I can see
  const mine = new Array<number>(KINDS).fill(0);
  for (const k of v.hand) if (k < KINDS) mine[k]!++;
  therm(PL.hand, mine);
  if (v.drawn !== null) setP(PL.drawn, v.drawn, 1);
  if (v.claim) setP(PL.claim, v.claim.tile, 1);

  const visible = mine.slice();
  v.players.forEach((p, r) => {
    const S = PL.seats[r]!;
    const meldTiles = new Array<number>(KINDS).fill(0);
    p.melds.forEach((m, j) => {
      for (const k of m.kinds) {
        meldTiles[k]!++;
        visible[k]!++;
      }
      if (m.type === 'chi') addP(S.chiLow, m.kind, 0.25);
      else if (m.type === 'pong') setP(S.pong, m.kind, 1);
      else if (m.added) setP(S.kongAdded, m.kind, 1);
      else if (m.concealed) setP(S.kongConcealed, m.kind, 1);
      else setP(S.kongExposed, m.kind, 1);
      if (m.claimed !== null) addP(S.claimed, m.claimed, 0.25);
      if (j < MAX_MELDS) for (const k of new Set(m.kinds)) setP(S.meldSlot + j, k, 1);
    });
    therm(S.meld, meldTiles);
    const gone = new Array<number>(KINDS).fill(0);
    for (const d of p.discards) {
      gone[d.kind]!++;
      if (!d.called) {
        addP(S.pond, d.kind, 0.25);
        visible[d.kind]!++;
      }
      if (d.tsumogiri) addP(S.tsumogiri, d.kind, 0.25);
    }
    therm(S.gone, gone);
    const last = p.discards[p.discards.length - 1];
    if (last) setP(S.last, last.kind, 1);
    p.discards
      .slice(-SEQ)
      .reverse()
      .forEach((d, j) => setP(S.seq + j, d.kind, 1));
  });
  therm(
    PL.unseen,
    visible.map((n) => Math.max(0, 4 - n)),
  );
  for (let r = 0; r < 4; r++) {
    const wind = (v.seatWind + r) % 4;
    for (let k = DRAGON0; k < DRAGON0 + 3; k++) setP(PL.value + r, k, rules.faan.dragonPong / 4);
    addP(PL.value + r, WIND0 + wind, rules.faan.seatWind / 4);
    addP(PL.value + r, WIND0 + v.prevailing, rules.faan.prevailingWind / 4);
  }

  // ---- hand analysis (derived from the view only)
  const me = v.players[0]!;
  const sets = 4 - me.melds.length;
  const opts = getVariant('hk').shape(rules);
  const total = mine.reduce((a, b) => a + b, 0);
  const sh = shanten(mine, sets, opts);
  setG(GL.shanten + shantenBin(sh), 1);
  if (total % 3 === 2) {
    // Holding a tile too many (my turn): what each discard leaves.
    const seen = visible.map((n) => Math.min(4, n));
    const list = analyzeDiscards(mine, sets, seen, opts);
    const best = Math.min(...list.map((d) => d.shanten));
    let bestAcc = 0;
    for (const d of list) {
      setP(PL.discardShanten, d.kind, 1 - shantenBin(d.shanten) / 8);
      if (d.shanten === best) {
        setP(PL.discardBest, d.kind, 1);
        bestAcc = Math.max(bestAcc, d.acceptance);
      }
      setP(PL.discardAccept, d.kind, d.acceptance / 80);
    }
    setG(GL.bestDiscardAccept, bestAcc / 80);
  } else if (total % 3 === 1) {
    if (sh === 0) {
      const w = waits(mine, sets, opts);
      let left = 0;
      let readyWithFaan = false;
      let bestRon = 0;
      let bestTsumo = 0;
      let bestRonPts = 0;
      const feeder = v.claim?.from ?? 3;
      for (const k of w) {
        setP(PL.wait, k, 1);
        left += Math.max(0, 4 - visible[k]!);
        const ron = wouldWin(v, k, false, feeder);
        const tsumo = wouldWin(v, k, true, null);
        if (ron) {
          setP(PL.ronFaan, k, ron.faan / maxF);
          bestRon = Math.max(bestRon, ron.faan);
          bestRonPts = Math.max(bestRonPts, ron.points);
        }
        if (tsumo) {
          setP(PL.tsumoFaan, k, tsumo.faan / maxF);
          bestTsumo = Math.max(bestTsumo, tsumo.faan);
        }
        if (ron || tsumo) readyWithFaan = true;
      }
      setG(GL.waits, w.length / 13);
      setG(GL.waitsLeft, left / 20);
      setG(GL.canWinOnWait, readyWithFaan ? 1 : 0);
      setG(GL.bestRonFaan, bestRon / maxF);
      setG(GL.bestTsumoFaan, bestTsumo / maxF);
      setG(GL.bestRonPoints, bestRonPts / maxPts);
    } else {
      const x = mine.slice();
      for (let k = 0; k < KINDS; k++) {
        if (x[k]! >= 4) continue;
        x[k]!++;
        if (shanten(x, sets, opts) < sh) setP(PL.improve, k, 1);
        x[k]!--;
      }
    }
  }

  // Calls on offer: the shanten each one leaves, and what the win would score.
  if (v.claim?.asked) {
    const k = v.claim.tile;
    const m = v.mask;
    if (m[SLOT.ron]) {
      const ron = wouldWin(v, k, false, v.claim.from, v.claim.kind === 'robKong');
      if (ron) {
        setG(GL.ronNow, ron.faan / maxF);
        setG(GL.ronNow + 1, ron.points / maxPts);
      }
    }
    const after = (use: Kind[]) => 1 - shantenBin(shantenAfterCall(mine, use, sets, opts)) / 8;
    if (m[SLOT.pong]) setG(GL.callShanten, after([k, k]));
    if (m[SLOT.claimKong]) {
      const x = mine.slice();
      x[k]! -= 3;
      setG(GL.callShanten + 1, 1 - shantenBin(shanten(x, sets - 1, opts)) / 8);
    }
    for (let d = 0; d < 3; d++) {
      if (!m[SLOT.chi + d]) continue;
      const low = k - d;
      setG(GL.callShanten + 2 + d, after([low, low + 1, low + 2].filter((x) => x !== k)));
    }
  }
  if (v.mask[SLOT.tsumo] && v.drawn !== null) {
    const t = wouldWin(v, v.drawn, true, null);
    if (t) {
      setG(GL.tsumoNow, t.faan / maxF);
      setG(GL.tsumoNow + 1, t.points / maxPts);
    }
  }

  // ---- the match
  const start = Math.max(1, rules.startingScore);
  setG(GL.seatWind + v.seatWind, 1);
  setG(GL.prevailing + Math.min(3, v.prevailing), 1);
  setG(GL.dealer + v.dealer, 1);
  setG(GL.passInRound + (v.passes % 4), 1);
  setG(GL.handsLeft, Math.max(0, rules.rounds * 4 - v.passes) / 16);
  setG(GL.allLast, v.prevailing === rules.rounds - 1 && v.passes % 4 === 3 ? 1 : 0);
  setG(GL.handNo, Math.min(1, v.handNo / 32));
  setG(GL.streak + Math.min(4, v.streak), 1);
  setG(GL.streakScaled, Math.min(1, v.streak / 8));
  v.scores.forEach((x, r) => {
    setG(GL.score + r, (x - start) / start);
    const rank = v.scores.filter((y, q) => y > x || (y === x && q < r)).length;
    setG(GL.rank[r]! + rank, 1);
    if (r > 0) setG(GL.lead + r - 1, (v.scores[0]! - x) / start);
  });

  // ---- the hand
  if (v.phase !== 'act' && v.phase !== 'claim' && v.phase !== 'end') throw new Error(`unexpected phase ${v.phase}`);
  setG(GL.phase + ['act', 'claim', 'end'].indexOf(v.phase), 1);
  setG(GL.turn + v.turn, 1);
  setG(GL.drawKind + ['deal', 'wall', 'replacement', 'claim'].indexOf(v.drawKind), 1);
  setG(GL.kongChain, v.kongChain / 3);
  if (v.claim) {
    setG(GL.claimOn, 1);
    setG(GL.claimRob, v.claim.kind === 'robKong' ? 1 : 0);
    setG(GL.claimFrom + v.claim.from, 1);
    setG(GL.claimAsked, v.claim.asked ? 1 : 0);
  }
  v.mask.forEach((x, i) => setG(GL.mask + i, x));
  setG(GL.live, v.liveLeft / LIVE0);
  setG(GL.liveZero, v.liveLeft === 0 ? 1 : 0);
  setG(GL.liveFive, v.liveLeft <= 5 ? 1 : 0);
  setG(GL.backDraws, v.backDraws / 16);
  setG(GL.discards, v.discards / 80);
  setG(GL.calls, v.calls / 12);
  setG(GL.noCalls, v.calls === 0 ? 1 : 0);

  v.players.forEach((p, r) => {
    const S = GL.seats[r]!;
    const wind = (v.seatWind + r) % 4;
    setG(S.played, p.played / 24);
    setG(S.concealed, p.concealed / 14);
    setG(S.melds, p.melds.length / 4);
    setG(S.open, p.melds.some((m) => !m.concealed) ? 1 : 0);
    setG(S.concealedKongs, p.melds.filter((m) => m.concealed).length / 4);
    setG(S.bonusCount, p.bonus.length / 8);
    setG(S.seatBonus, p.bonus.filter((k) => (k - BONUS0) % 4 === wind).length / 2);
    const has = (k: Kind) => p.bonus.includes(k);
    setG(S.flowerSet, [34, 35, 36, 37].every(has) ? 1 : 0);
    setG(S.flowerSet + 1, [38, 39, 40, 41].every(has) ? 1 : 0);
    for (const k of p.bonus) setG(S.bonus + (k - BONUS0), 1);
    p.melds.slice(0, MAX_MELDS).forEach((m, j) => {
      const at = S.meldMeta[j]!;
      setG(at, 1);
      const type = m.type === 'chi' ? 1 : m.type === 'pong' ? 2 : m.added ? 5 : m.concealed ? 4 : 3;
      setG(at + type, 1);
      setG(at + 6 + (m.from === null ? 0 : m.from), 1);
      setG(at + 10, m.time / 80);
    });
    p.discards
      .slice(-SEQ)
      .reverse()
      .forEach((d, j) => {
        const at = S.discardMeta[j]!;
        setG(at, 1);
        setG(at + 1, d.tsumogiri ? 1 : 0);
        setG(at + 2, d.called ? 1 : 0);
        setG(at + 3, (v.discards - 1 - d.time) / 80);
        setG(at + 4, d.time / 80);
      });
  });

  // ---- the rules (so one network can play any house-rule setup)
  const R = GL.rules;
  setG(R, rules.minFaan / 13);
  setG(R + 1, rules.maxFaan / 13);
  setG(R + 2, rules.spicy === 'full' ? 1 : 0);
  setG(R + 3, rules.payment === 'fullGun' ? 1 : 0);
  setG(R + 4, rules.liability ? 1 : 0);
  setG(R + 5, rules.sevenPairs ? 1 : 0);
  setG(R + 6, rules.flowerHands ? 1 : 0);
  setG(R + 7, rules.multiWin ? 1 : 0);
  setG(R + 8, rules.dealerStaysOnDraw ? 1 : 0);
  setG(R + 9, rules.robConcealedKong ? 1 : 0);
  setG(R + 10 + (rules.rounds === 1 ? 0 : rules.rounds === 2 ? 1 : 2), 1);
  setG(R + 13, rules.startingScore / 1000);
  FAAN_TABLE.forEach((e, i) => setG(GL.faan + i, (rules.faan[e.id] ?? e.faan) / 13));

  return out;
}

/** seatView + encode. */
export function observe(s: MatchState, seat: number): Float32Array {
  return encode(seatView(s, seat));
}
