// The table engine: a pure, deterministic state machine shared by every
// variant. `applyAction(state, action)` returns the next state; nothing here
// touches the DOM, the network or Math.random (the wall shuffle draws from
// `state.rng`). Every device that starts from the same MatchConfig and applies
// the same actions holds the same state — that's what the online action log
// relies on.
//
// Seats are physical (0–3) and turn order runs 0 → 1 → 2 → 3: seat s+1 is s's
// 下家 (sits to its right), seat s−1 its 上家 (on its left, the only seat it may
// chow from). The dealer is always East; seat winds rotate with the deal.

import { analyzeDiscards } from './hand';
import { Rng } from './rng';
import { idsForKinds, isBonus, isSuit, kindOf, tileIds, type Kind, type TileId } from './tiles';
import { getVariant, type AnyRules, type MeldFact, type PlayableVariant, type Settlement, type VariantId, type WinInput, type WinScore } from './variants';

export type AiLevel = 'easy' | 'normal' | 'hard';

export interface SeatConfig {
  name: string;
  ai: boolean;
  level?: AiLevel;
  /** Online: the device (uuid) that owns this human seat. */
  uuid?: string;
}

export interface MatchConfig {
  variant: VariantId;
  rules: AnyRules;
  seats: SeatConfig[];
  seed: number;
}

export interface Meld {
  type: 'chi' | 'pong' | 'kong';
  tiles: TileId[];
  /** Pong / kong kind, or a chow's lowest kind. */
  kind: Kind;
  /** A concealed kong (暗槓). */
  concealed: boolean;
  /** The seat whose discard was claimed (null for a concealed kong). */
  from: number | null;
  /** The claimed discard's id. */
  claimed: TileId | null;
  order: number;
  /** An added kong (加槓) made from an exposed pong. */
  added?: boolean;
}

export interface Player {
  /** Concealed tiles, sorted. */
  hand: TileId[];
  melds: Meld[];
  bonus: TileId[];
  discards: TileId[];
}

export type Claim = { type: 'pass' } | { type: 'win' } | { type: 'pong' } | { type: 'kong' } | { type: 'chi'; low: Kind };

export interface ClaimWindow {
  kind: 'discard' | 'robKong';
  tile: TileId;
  from: number;
  /** Per seat, the claims it may make (pass not listed; empty = not asked). */
  options: Claim[][];
  /** Per seat: its answer, or null while it's still deciding. */
  responses: (Claim | null)[];
}

export type HandEvent =
  | { t: 'bonus'; seat: number; tile: TileId }
  | { t: 'discard'; seat: number; tile: TileId }
  | { t: 'chi' | 'pong'; seat: number; from: number; tile: TileId }
  | { t: 'kong'; seat: number; how: 'exposed' | 'concealed' | 'added'; tile: TileId }
  | { t: 'win'; seat: number; from: number | null }
  | { t: 'exhausted' };

export interface WinRecord {
  seat: number;
  from: number | null;
  tile: TileId | null;
  selfDraw: boolean;
  robbingKong: boolean;
  flowerWin: WinInput['flowerWin'];
  score: WinScore;
  settlement: Settlement;
  /** The winning hand as shown: concealed tiles (winning tile included), melds, bonus tiles. */
  hand: TileId[];
  melds: Meld[];
  bonus: TileId[];
}

export interface HandResult {
  handNo: number;
  dealer: number;
  prevailing: number;
  wins: WinRecord[];
  deltas: number[];
  dealerStays: boolean;
}

export interface HandState {
  /** Every tile of the wall in draw order: live draws from the front, replacements from the back. */
  wall: TileId[];
  head: number;
  tail: number;
  /** Cosmetic: the stack where the wall was broken, and the dice that chose it. */
  breakAt: number;
  dice: [number, number];
  players: Player[];
  turn: number;
  phase: 'act' | 'claim' | 'end';
  /** The tile the turn player just drew (null after a chow / pong). */
  drawn: TileId | null;
  /** How the turn player's current tile arrived. */
  drawKind: 'deal' | 'wall' | 'replacement' | 'claim';
  /** Kongs declared in a row this turn (2+ = 槓上槓 if the replacement wins). */
  kongChain: number;
  claim: ClaimWindow | null;
  lastDiscard: { tile: TileId; from: number } | null;
  discards: number;
  calls: number;
  log: HandEvent[];
  result: HandResult | null;
  ready: boolean[];
}

export interface MatchState {
  v: 1;
  config: MatchConfig;
  rng: number;
  scores: number[];
  prevailing: number;
  dealer: number;
  /** Hands in a row the dealer has kept the deal (連莊). */
  streak: number;
  /** Times the deal has passed; every four the prevailing wind moves on. */
  passes: number;
  handNo: number;
  hand: HandState;
  history: HandResult[];
  over: boolean;
  /** Actions applied so far. */
  seq: number;
}

export type Action =
  | { type: 'discard'; seat: number; tile: TileId }
  | { type: 'kong'; seat: number; kind: Kind }
  | { type: 'win'; seat: number }
  | { type: 'claim'; seat: number; claim: Claim }
  | { type: 'ready'; seat: number };

export class IllegalAction extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'IllegalAction';
  }
}

// ------------------------------------------------------------ helpers

export const seatWind = (s: MatchState, seat: number) => (seat - s.dealer + 4) % 4;
export const variantOf = (s: MatchState): PlayableVariant => getVariant(s.config.variant);
const rulesOf = (s: MatchState) => s.config.rules;
/** Live tiles still drawable. */
export const liveLeft = (s: MatchState) => s.hand.tail - s.hand.head - variantOf(s).reserve;
const sortTiles = (tiles: TileId[]) => tiles.sort((a, b) => kindOf(a) - kindOf(b) || a - b);
const kinds = (tiles: readonly TileId[]) => tiles.map(kindOf);
const countOf = (tiles: readonly TileId[], k: Kind) => tiles.reduce((n, t) => n + (kindOf(t) === k ? 1 : 0), 0);
/** Forward distance in turn order from `from` to `to` (1–3). */
export const turnDistance = (from: number, to: number) => (to - from + 4) % 4 || 4;
const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

function takeTiles(hand: TileId[], k: Kind, n: number): TileId[] {
  const out: TileId[] = [];
  for (let i = hand.length - 1; i >= 0 && out.length < n; i--) {
    if (kindOf(hand[i]!) === k) out.push(...hand.splice(i, 1));
  }
  if (out.length < n) throw new IllegalAction(`needs ${n} of kind ${k}`);
  return out;
}

function meldFacts(p: Player): MeldFact[] {
  return p.melds.map((m) => ({ type: m.type, kind: m.kind, concealed: m.concealed, from: m.from, order: m.order }));
}

/** Copies of `k` anyone can see: discards and melds (own hand excluded). */
export function visibleCopies(s: MatchState, k: Kind, except?: TileId): number {
  let n = 0;
  for (const p of s.hand.players) {
    for (const t of p.discards) if (t !== except && kindOf(t) === k) n++;
    for (const m of p.melds) for (const t of m.tiles) if (t !== except && kindOf(t) === k) n++;
  }
  return n;
}

// ------------------------------------------------------------ setup

export function createMatch(config: MatchConfig): MatchState {
  const variant = getVariant(config.variant);
  if (config.seats.length !== 4) throw new Error('A match needs four seats.');
  const rng = new Rng(config.seed);
  const dealer = rng.int(4);
  const state: MatchState = {
    v: 1,
    config: clone(config),
    rng: rng.state,
    scores: [0, 1, 2, 3].map(() => variant.startingScore(config.rules)),
    prevailing: 0,
    dealer,
    streak: 0,
    passes: 0,
    handNo: 1,
    hand: null as unknown as HandState, // dealt just below
    history: [],
    over: false,
    seq: 0,
  };
  dealHand(state);
  return state;
}

/**
 * Test hook: a match whose first hand is dealt from a fixed wall. `front` is
 * drawn first (the deal, then the draws in turn order); `back` lists the
 * replacement draws in the order they're taken. Unlisted tiles fill the
 * middle, bonus tiles first, so stray flowers stay out of the way.
 */
export function createRiggedMatch(config: MatchConfig, opts: { dealer?: number; front: Kind[]; back?: Kind[] }): MatchState {
  const state = createMatch(config);
  state.dealer = opts.dealer ?? 0;
  const used = new Set<TileId>();
  const front = idsForKinds(opts.front, used);
  const back = idsForKinds(opts.back ?? [], used);
  const rest = tileIds(variantOf(state).tiles)
    .filter((id) => !used.has(id))
    .sort((a, b) => Number(isBonus(kindOf(b))) - Number(isBonus(kindOf(a))) || a - b);
  dealHand(state, [...front, ...rest, ...back.reverse()]);
  return state;
}

function dealHand(s: MatchState, fixedWall?: TileId[]): void {
  const variant = variantOf(s);
  const rng = new Rng(s.rng);
  const wall = fixedWall ?? rng.shuffle(tileIds(variant.tiles));
  // The dealer's dice pick whose wall is broken (counting the dealer as 1,
  // counter-clockwise) and how many stacks in from its right end. Stacks are
  // numbered clockwise around the table, 18 per side; see wallStacks().
  const dice: [number, number] = [rng.int(6) + 1, rng.int(6) + 1];
  const sum = dice[0] + dice[1];
  const stacks = Math.ceil(wall.length / 2);
  const owner = (s.dealer + sum - 1) % 4;
  const breakAt = (((4 - owner) % 4) * (stacks / 4) + sum) % stacks;
  s.rng = rng.state;
  s.hand = {
    wall,
    head: 0,
    tail: wall.length,
    breakAt,
    dice,
    players: [0, 1, 2, 3].map(() => ({ hand: [], melds: [], bonus: [], discards: [] })),
    turn: s.dealer,
    phase: 'act',
    drawn: null,
    drawKind: 'deal',
    kongChain: 0,
    claim: null,
    lastDiscard: null,
    discards: 0,
    calls: 0,
    log: [],
    result: null,
    ready: [false, false, false, false],
  };
  const h = s.hand;
  // Deal in blocks of four, then one each, starting with the dealer.
  const order = [0, 1, 2, 3].map((i) => (s.dealer + i) % 4);
  let dealt = 0;
  while (dealt < variant.handSize) {
    const n = Math.min(4, variant.handSize - dealt);
    for (const seat of order) for (let i = 0; i < n; i++) h.players[seat]!.hand.push(h.wall[h.head++]!);
    dealt += n;
  }
  // Bonus tiles are set aside and replaced from the back, seat by seat.
  for (const seat of order) {
    const p = h.players[seat]!;
    while (h.phase !== 'end') {
      const i = p.hand.findIndex((t) => isBonus(kindOf(t)));
      if (i < 0) break;
      const [b] = p.hand.splice(i, 1);
      if (takeBonus(s, seat, b!)) break;
      if (h.tail - h.head <= variant.reserve) return endExhausted(s);
      p.hand.push(h.wall[--h.tail]!);
    }
    sortTiles(p.hand);
    if (h.phase === 'end') return;
  }
  draw(s, s.dealer, 'deal');
}

// ------------------------------------------------------------ drawing

/** Set a bonus tile aside; returns true when it ended the hand (八仙過海 / 七搶一). */
function takeBonus(s: MatchState, seat: number, tile: TileId): boolean {
  const h = s.hand;
  h.players[seat]!.bonus.push(tile);
  h.log.push({ t: 'bonus', seat, tile });
  const variant = variantOf(s);
  if (!variant.flowerWins(rulesOf(s)) || variant.tiles.bonus !== 8) return false;
  const counts = h.players.map((p) => p.bonus.length);
  if (counts.reduce((a, b) => a + b, 0) !== 8) return false;
  const eight = counts.indexOf(8);
  if (eight >= 0) {
    finishWins(s, [{ seat: eight, from: null, tile: null, selfDraw: true, robbingKong: false, flowerWin: 'eight' }]);
    return true;
  }
  const seven = counts.indexOf(7);
  if (seven >= 0) {
    const payer = counts.indexOf(1);
    finishWins(s, [{ seat: seven, from: payer, tile: null, selfDraw: false, robbingKong: false, flowerWin: 'sevenRobOne' }]);
    return true;
  }
  return false;
}

/** The turn passes to `seat`, who draws. Ends the hand when the wall is exhausted. */
function draw(s: MatchState, seat: number, kind: 'deal' | 'wall' | 'replacement'): void {
  const h = s.hand;
  const variant = variantOf(s);
  h.turn = seat;
  h.claim = null;
  let fromBack = kind === 'replacement';
  for (;;) {
    if (h.tail - h.head <= variant.reserve) return endExhausted(s);
    const tile = fromBack ? h.wall[--h.tail]! : h.wall[h.head++]!;
    if (isBonus(kindOf(tile))) {
      if (takeBonus(s, seat, tile)) return;
      fromBack = true;
      continue;
    }
    const p = h.players[seat]!;
    p.hand.push(tile);
    sortTiles(p.hand);
    h.drawn = tile;
    h.drawKind = kind;
    h.phase = 'act';
    return;
  }
}

function endExhausted(s: MatchState): void {
  const h = s.hand;
  h.log.push({ t: 'exhausted' });
  endHand(s, []);
}

// ------------------------------------------------------------ win checks

interface WinCtx {
  seat: number;
  from: number | null;
  tile: TileId | null;
  selfDraw: boolean;
  robbingKong: boolean;
  flowerWin: WinInput['flowerWin'];
}

function buildWinInput(s: MatchState, c: WinCtx): WinInput {
  const h = s.hand;
  const p = h.players[c.seat]!;
  const concealed = kinds(p.hand);
  if (!c.selfDraw && c.tile !== null && !c.flowerWin) concealed.push(kindOf(c.tile));
  const winTile = c.tile === null ? -1 : kindOf(c.tile);
  const firstDiscard = h.discards === 1 && h.calls === 0 && h.players.every((q) => q.melds.length === 0);
  return {
    seat: c.seat,
    seatWind: seatWind(s, c.seat),
    prevailing: s.prevailing,
    dealer: s.dealer,
    concealed,
    winTile,
    melds: meldFacts(p),
    bonus: kinds(p.bonus),
    selfDraw: c.selfDraw,
    from: c.from,
    robbingKong: c.robbingKong,
    lastTile: !c.flowerWin && !c.robbingKong && liveLeft(s) === 0,
    kongReplacement: c.selfDraw && h.drawKind === 'replacement' ? h.kongChain : 0,
    heavenly: c.selfDraw && c.seat === s.dealer && h.drawKind === 'deal' && h.discards === 0 && p.melds.length === 0,
    earthly: !c.selfDraw && !c.robbingKong && c.from === s.dealer && c.seat !== s.dealer && firstDiscard,
    flowerWin: c.flowerWin,
    wallLeft: liveLeft(s),
    discardUnseen: !c.selfDraw && c.tile !== null && visibleCopies(s, kindOf(c.tile), c.tile) === 0,
  };
}

/** Score a would-be win, or null when it isn't a legal one (shape or minimum). */
function legalWin(s: MatchState, c: WinCtx): WinScore | null {
  const variant = variantOf(s);
  const input = buildWinInput(s, c);
  const score = variant.evaluate(input, rulesOf(s));
  return score && variant.canWin(score, rulesOf(s)) ? score : null;
}

/** The score a winning tile would give `seat` right now (UI hints, AI). */
export function previewWin(s: MatchState, seat: number, tile: TileId, selfDraw: boolean): WinScore | null {
  return legalWin(s, { seat, from: selfDraw ? null : s.hand.turn, tile, selfDraw, robbingKong: false, flowerWin: null });
}

function finishWins(s: MatchState, wins: WinCtx[]): void {
  const variant = variantOf(s);
  const h = s.hand;
  const records: WinRecord[] = [];
  for (const c of wins) {
    const input = buildWinInput(s, c);
    const score = variant.evaluate(input, rulesOf(s));
    if (!score) throw new IllegalAction('not a winning hand');
    const p = h.players[c.seat]!;
    const hand = [...p.hand];
    if (!c.selfDraw && c.tile !== null && !c.flowerWin) hand.push(c.tile);
    records.push({
      seat: c.seat,
      from: c.from,
      tile: c.tile,
      selfDraw: c.selfDraw,
      robbingKong: c.robbingKong,
      flowerWin: c.flowerWin,
      score,
      settlement: variant.settle(input, score, rulesOf(s)),
      hand: sortTiles(hand),
      melds: clone(p.melds),
      bonus: [...p.bonus],
    });
    h.log.push({ t: 'win', seat: c.seat, from: c.from });
  }
  endHand(s, records);
}

function endHand(s: MatchState, wins: WinRecord[]): void {
  const h = s.hand;
  const deltas = [0, 0, 0, 0];
  for (const w of wins) w.settlement.deltas.forEach((d, i) => (deltas[i]! += d));
  deltas.forEach((d, i) => (s.scores[i]! += d));
  const variant = variantOf(s);
  h.phase = 'end';
  h.claim = null;
  h.result = {
    handNo: s.handNo,
    dealer: s.dealer,
    prevailing: s.prevailing,
    wins,
    deltas,
    dealerStays: variant.dealerStays(
      wins.map((w) => w.seat),
      s.dealer,
      rulesOf(s),
    ),
  };
}

function nextHand(s: MatchState): void {
  const result = s.hand.result!;
  s.history.push(result);
  if (result.dealerStays) {
    s.streak++;
  } else {
    s.dealer = (s.dealer + 1) % 4;
    s.streak = 0;
    s.passes++;
    if (s.passes % 4 === 0) s.prevailing++;
  }
  if (s.prevailing >= variantOf(s).rounds(rulesOf(s))) {
    s.over = true;
    return;
  }
  s.handNo++;
  dealHand(s);
}

// ------------------------------------------------------------ legal moves

export interface TurnOptions {
  canDiscard: boolean;
  /** Kinds this seat may kong now (concealed or added). */
  kongs: Kind[];
  /** Self-draw win available (the score it would make). */
  win: WinScore | null;
}

export function turnOptions(s: MatchState, seat: number): TurnOptions {
  const h = s.hand;
  const none: TurnOptions = { canDiscard: false, kongs: [], win: null };
  if (s.over || h.phase !== 'act' || h.turn !== seat) return none;
  const p = h.players[seat]!;
  const kongs: Kind[] = [];
  // After claiming a chow / pong you discard straight away: kongs wait for a draw.
  if (liveLeft(s) > 0 && h.drawKind !== 'claim') {
    const seen = new Set<Kind>();
    for (const t of p.hand) {
      const k = kindOf(t);
      if (seen.has(k)) continue;
      seen.add(k);
      if (countOf(p.hand, k) === 4) kongs.push(k);
      else if (p.melds.some((m) => m.type === 'pong' && m.kind === k)) kongs.push(k);
    }
  }
  const win =
    h.drawKind !== 'claim' && h.drawn !== null
      ? legalWin(s, { seat, from: null, tile: h.drawn, selfDraw: true, robbingKong: false, flowerWin: null })
      : null;
  return { canDiscard: true, kongs, win };
}

/** Chow options: the lowest kind of each sequence `discard` can complete from `hand`. */
function chiOptions(hand: readonly TileId[], k: Kind): Kind[] {
  if (!isSuit(k)) return [];
  const has = (x: Kind) => x >= 0 && Math.floor(x / 9) === Math.floor(k / 9) && countOf(hand, x) > 0;
  const out: Kind[] = [];
  for (const low of [k - 2, k - 1, k]) {
    if (Math.floor(low / 9) !== Math.floor(k / 9) || low % 9 > 6) continue;
    if ([low, low + 1, low + 2].every((x) => x === k || has(x))) out.push(low);
  }
  return out;
}

function discardClaims(s: MatchState, seat: number, tile: TileId, from: number): Claim[] {
  const h = s.hand;
  const p = h.players[seat]!;
  const k = kindOf(tile);
  const out: Claim[] = [];
  if (legalWin(s, { seat, from, tile, selfDraw: false, robbingKong: false, flowerWin: null })) out.push({ type: 'win' });
  // Off the last tile only a win may be claimed.
  if (liveLeft(s) > 0) {
    const n = countOf(p.hand, k);
    if (n >= 2) out.push({ type: 'pong' });
    if (n >= 3) out.push({ type: 'kong' });
    if (variantOf(s).claims.chi === 'left' && seat === (from + 1) % 4) {
      for (const low of chiOptions(p.hand, k)) out.push({ type: 'chi', low });
    }
  }
  return out;
}

export function claimOptions(s: MatchState, seat: number): Claim[] {
  const c = s.hand.claim;
  if (s.over || s.hand.phase !== 'claim' || !c || c.responses[seat] !== null) return [];
  return c.options[seat]!;
}

/** Seats the game is waiting on. */
export function pendingSeats(s: MatchState): number[] {
  const h = s.hand;
  if (s.over) return [];
  if (h.phase === 'act') return [h.turn];
  if (h.phase === 'claim') return [0, 1, 2, 3].filter((i) => h.claim!.responses[i] === null);
  return [0, 1, 2, 3].filter((i) => !h.ready[i]);
}

// ------------------------------------------------------------ claims

const PRIORITY = { pass: 0, chi: 1, pong: 2, kong: 2, win: 3 } as const;

function openClaimWindow(s: MatchState, kind: ClaimWindow['kind'], tile: TileId, from: number, options: Claim[][]): boolean {
  if (options.every((o) => o.length === 0)) return false;
  s.hand.claim = {
    kind,
    tile,
    from,
    options,
    responses: options.map((o) => (o.length === 0 ? { type: 'pass' } : null)),
  };
  s.hand.phase = 'claim';
  return true;
}

function afterDiscard(s: MatchState, tile: TileId, from: number): void {
  const options = [0, 1, 2, 3].map((seat) => (seat === from ? [] : discardClaims(s, seat, tile, from)));
  if (!openClaimWindow(s, 'discard', tile, from, options)) nextTurn(s, from);
}

function nextTurn(s: MatchState, from: number): void {
  const h = s.hand;
  h.claim = null;
  h.kongChain = 0;
  draw(s, (from + 1) % 4, 'wall');
}

/** Resolve the claim window once no pending answer could beat the best one received. */
function tryResolve(s: MatchState): void {
  const c = s.hand.claim!;
  const multi = variantOf(s).multiWin(rulesOf(s));
  const rank = (seat: number, claim: Claim) => PRIORITY[claim.type] * 10 - turnDistance(c.from, seat);
  let best: { seat: number; claim: Claim } | null = null;
  c.responses.forEach((r, seat) => {
    if (r && r.type !== 'pass' && (!best || rank(seat, r) > rank(best.seat, best.claim))) best = { seat, claim: r };
  });
  const top = best as { seat: number; claim: Claim } | null;
  const pending = c.responses.map((r, seat) => (r === null ? seat : -1)).filter((seat) => seat >= 0);
  const couldBeat = pending.some((seat) =>
    c.options[seat]!.some((o) => {
      if (!top) return true;
      if (multi && o.type === 'win' && top.claim.type === 'win') return true;
      return rank(seat, o) > rank(top.seat, top.claim);
    }),
  );
  if (couldBeat) return;
  pending.forEach((seat) => (c.responses[seat] = { type: 'pass' }));

  const winners = c.responses
    .map((r, seat) => (r?.type === 'win' ? seat : -1))
    .filter((seat) => seat >= 0)
    .sort((a, b) => turnDistance(c.from, a) - turnDistance(c.from, b));
  if (winners.length > 0) {
    const chosen = multi ? winners : winners.slice(0, 1);
    if (c.kind === 'robKong') unKong(s, c.from, c.tile);
    finishWins(
      s,
      chosen.map((seat) => ({ seat, from: c.from, tile: c.tile, selfDraw: false, robbingKong: c.kind === 'robKong', flowerWin: null })),
    );
    return;
  }
  if (c.kind === 'robKong') {
    // Nobody robbed: the kong stands and the konger draws its replacement.
    s.hand.claim = null;
    draw(s, c.from, 'replacement');
    return;
  }
  if (!top) return nextTurn(s, c.from);
  applyClaim(s, top.seat, top.claim, c.tile, c.from);
}

function applyClaim(s: MatchState, seat: number, claim: Claim, tile: TileId, from: number): void {
  const h = s.hand;
  const p = h.players[seat]!;
  const k = kindOf(tile);
  h.players[from]!.discards.pop();
  let taken: TileId[];
  let type: Meld['type'];
  let kind = k;
  if (claim.type === 'pong') {
    taken = takeTiles(p.hand, k, 2);
    type = 'pong';
  } else if (claim.type === 'kong') {
    taken = takeTiles(p.hand, k, 3);
    type = 'kong';
  } else if (claim.type === 'chi') {
    taken = [claim.low, claim.low + 1, claim.low + 2].filter((x) => x !== k).flatMap((x) => takeTiles(p.hand, x, 1));
    type = 'chi';
    kind = claim.low;
  } else {
    throw new IllegalAction(`can't apply ${claim.type}`);
  }
  p.melds.push({ type, tiles: sortTiles([...taken, tile]), kind, concealed: false, from, claimed: tile, order: p.melds.length });
  h.calls++;
  h.claim = null;
  h.lastDiscard = null;
  if (type === 'kong') {
    h.log.push({ t: 'kong', seat, how: 'exposed', tile });
    h.kongChain = 1;
    draw(s, seat, 'replacement');
  } else {
    h.log.push({ t: type, seat, from, tile });
    h.turn = seat;
    h.phase = 'act';
    h.drawn = null;
    h.drawKind = 'claim';
    h.kongChain = 0;
  }
}

/** A robbed kong falls back to what it was before the kong. */
function unKong(s: MatchState, seat: number, tile: TileId): void {
  const p = s.hand.players[seat]!;
  const m = p.melds.find((x) => x.tiles.includes(tile))!;
  m.tiles = m.tiles.filter((t) => t !== tile);
  if (m.added) {
    m.type = 'pong';
    delete m.added;
  } else {
    p.melds.splice(p.melds.indexOf(m), 1);
    p.hand.push(...m.tiles);
    sortTiles(p.hand);
  }
}

function declareKong(s: MatchState, seat: number, k: Kind): void {
  const h = s.hand;
  const p = h.players[seat]!;
  const variant = variantOf(s);
  let tile: TileId;
  let options: Claim[][];
  const robbers = (thirteenOnly: boolean): Claim[][] =>
    [0, 1, 2, 3].map((o) => {
      if (o === seat) return [];
      const score = legalWin(s, { seat: o, from: seat, tile, selfDraw: false, robbingKong: true, flowerWin: null });
      if (!score) return [];
      if (thirteenOnly && !score.items.some((i) => i.id === 'thirteenOrphans')) return [];
      return [{ type: 'win' } as Claim];
    });
  if (countOf(p.hand, k) === 4) {
    const four = takeTiles(p.hand, k, 4);
    tile = four[0]!;
    p.melds.push({ type: 'kong', tiles: sortTiles(four), kind: k, concealed: true, from: null, claimed: null, order: p.melds.length });
    h.log.push({ t: 'kong', seat, how: 'concealed', tile });
    options = variant.robConcealedKong(rulesOf(s)) ? robbers(true) : [[], [], [], []];
  } else {
    const m = p.melds.find((x) => x.type === 'pong' && x.kind === k);
    if (!m) throw new IllegalAction('no pong to add to');
    tile = takeTiles(p.hand, k, 1)[0]!;
    m.type = 'kong';
    m.added = true;
    m.tiles = sortTiles([...m.tiles, tile]);
    h.log.push({ t: 'kong', seat, how: 'added', tile });
    options = variant.claims.robKong ? robbers(false) : [[], [], [], []];
  }
  h.kongChain++;
  h.drawn = null;
  if (!openClaimWindow(s, 'robKong', tile, seat, options)) draw(s, seat, 'replacement');
}

// ------------------------------------------------------------ the reducer

function sameClaim(a: Claim, b: Claim): boolean {
  return a.type === b.type && (a.type !== 'chi' || (b.type === 'chi' && a.low === b.low));
}

/** Apply `action`; throws IllegalAction when it isn't legal right now. Never mutates `state`. */
export function applyAction(state: MatchState, action: Action): MatchState {
  if (state.over) throw new IllegalAction('the match is over');
  const s = clone(state);
  const h = s.hand;
  const seat = action.seat;
  if (!(seat >= 0 && seat < 4)) throw new IllegalAction('no such seat');
  switch (action.type) {
    case 'discard': {
      if (h.phase !== 'act' || h.turn !== seat) throw new IllegalAction('not your turn to discard');
      const p = h.players[seat]!;
      const i = p.hand.indexOf(action.tile);
      if (i < 0) throw new IllegalAction("that tile isn't in your hand");
      p.hand.splice(i, 1);
      p.discards.push(action.tile);
      h.discards++;
      h.drawn = null;
      h.lastDiscard = { tile: action.tile, from: seat };
      h.log.push({ t: 'discard', seat, tile: action.tile });
      afterDiscard(s, action.tile, seat);
      break;
    }
    case 'kong': {
      if (!turnOptions(state, seat).kongs.includes(action.kind)) throw new IllegalAction("can't kong that");
      declareKong(s, seat, action.kind);
      break;
    }
    case 'win': {
      const opts = turnOptions(state, seat);
      if (!opts.win) throw new IllegalAction('not a winning hand');
      finishWins(s, [{ seat, from: null, tile: h.drawn, selfDraw: true, robbingKong: false, flowerWin: null }]);
      break;
    }
    case 'claim': {
      if (h.phase !== 'claim' || !h.claim || h.claim.responses[seat] !== null) throw new IllegalAction('nothing to claim');
      const claim = action.claim;
      if (claim.type !== 'pass' && !h.claim.options[seat]!.some((o) => sameClaim(o, claim))) throw new IllegalAction("can't claim that");
      h.claim.responses[seat] = claim;
      tryResolve(s);
      break;
    }
    case 'ready': {
      if (h.phase !== 'end' || h.ready[seat]) throw new IllegalAction('nothing to confirm');
      h.ready[seat] = true;
      if (h.ready.every(Boolean)) nextHand(s);
      break;
    }
    default:
      throw new IllegalAction('unknown action');
  }
  s.seq++;
  return s;
}

/** applyAction, or null when the action is illegal. */
export function tryApply(state: MatchState, action: Action): MatchState | null {
  try {
    return applyAction(state, action);
  } catch (e) {
    if (e instanceof IllegalAction) return null;
    throw e;
  }
}

/** A short checksum of a state (online: every device should build the same opening). */
export function checksum(s: MatchState): string {
  const text = JSON.stringify([s.hand.wall, s.dealer, s.scores, s.config.rules]);
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619);
  return (h >>> 0).toString(36);
}

// ------------------------------------------------------------ views

/** Everything one seat may legitimately know, as count vectors (AI, hints, trainer). */
export function visibleCounts(s: MatchState, seat: number): number[] {
  const c = new Array<number>(34).fill(0);
  const add = (t: TileId) => {
    const k = kindOf(t);
    if (k < 34) c[k]!++;
  };
  s.hand.players.forEach((p, i) => {
    p.discards.forEach(add);
    p.melds.forEach((m) => m.tiles.forEach(add));
    if (i === seat) p.hand.forEach(add);
  });
  return c;
}

/** Sets the concealed part of `seat`'s hand still has to make. */
export function setsNeeded(s: MatchState, seat: number): number {
  return (variantOf(s).handSize - 1) / 3 - s.hand.players[seat]!.melds.length;
}

/** Discard analysis for the turn player (hints). */
export function discardHints(s: MatchState, seat: number) {
  const p = s.hand.players[seat]!;
  const counts = new Array<number>(34).fill(0);
  for (const t of p.hand) counts[kindOf(t)]!++;
  return analyzeDiscards(counts, setsNeeded(s, seat), visibleCounts(s, seat), variantOf(s).shape(rulesOf(s)));
}

/**
 * The wall in front of `seat` as its owner sees it, left to right: how many
 * tiles (0–2) each stack still holds. Live draws eat stacks clockwise from the
 * break (leftward along a wall); replacement draws take the other end.
 */
export function wallStacks(s: MatchState, seat: number): number[] {
  const h = s.hand;
  const stacks = Math.ceil(h.wall.length / 2);
  const per = stacks / 4;
  const side = (4 - seat) % 4;
  const out: number[] = [];
  for (let pos = 0; pos < per; pos++) {
    const q = side * per + (per - 1 - pos);
    const m = (q - h.breakAt + stacks) % stacks;
    out.push([2 * m, 2 * m + 1].filter((j) => j >= h.head && j < h.tail && j < h.wall.length).length);
  }
  return out;
}

/** Will the match end once the current (finished) hand is confirmed? */
export function isFinalHand(s: MatchState): boolean {
  const r = s.hand.result;
  if (!r || r.dealerStays) return false;
  const passes = s.passes + 1;
  const prevailing = passes % 4 === 0 ? s.prevailing + 1 : s.prevailing;
  return prevailing >= variantOf(s).rounds(rulesOf(s));
}
