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
//
// Variant mechanics are switched on by `variant.features`: riichi (riichi,
// ippatsu, furiten, dora, kuikae, honba, abortive draws) and american (the
// Charleston, jokers, exposures checked against the hand card).

import { analyzeDiscards, shanten, waits } from './hand';
import { Rng } from './rng';
import { JOKER, ORPHANS, idsForKinds, isBonus, isSuit, isWind, kindOf, tileIds, type Kind, type TileId } from './tiles';
import * as american from './variants/american';
import {
  doraFromIndicator,
  getVariant,
  type AnyRules,
  type MeldFact,
  type PlayableVariant,
  type Settlement,
  type VariantId,
  type WinInput,
  type WinScore,
} from './variants';

export type AiLevel = 'easy' | 'normal' | 'hard';

/** The difficulty levels as players see them ('normal' shows as Medium; saved setups and rooms keep the ids). */
export const AI_LEVELS: readonly { id: AiLevel; label: string }[] = [
  { id: 'easy', label: 'Easy' },
  { id: 'normal', label: 'Medium' },
  { id: 'hard', label: 'Hard' },
];
export const levelLabel = (level: AiLevel): string => AI_LEVELS.find((l) => l.id === level)?.label ?? level;

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
  /** 'set': an American exposure of 3–6 alike (jokers allowed). */
  type: 'chi' | 'pong' | 'kong' | 'set';
  tiles: TileId[];
  /** Pong / kong / set kind, or a chow's lowest kind. */
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
  /** Discards still in the pond. */
  discards: TileId[];
  /** Every tile this player discarded this hand, claimed ones included (furiten, nagashi). */
  gone: TileId[];
}

export type Claim =
  | { type: 'pass' }
  | { type: 'win' }
  | { type: 'pong' }
  | { type: 'kong' }
  | { type: 'chi'; low: Kind }
  /** American: expose `size` alike using the discard, naturals from hand and `jokers` jokers. */
  | { type: 'expose'; size: number; jokers: number };

export interface ClaimWindow {
  kind: 'discard' | 'robKong';
  tile: TileId;
  from: number;
  /** Per seat, the claims it may make (pass not listed; empty = not asked). */
  options: Claim[][];
  /** Per seat: its answer, or null while it's still deciding. */
  responses: (Claim | null)[];
}

export interface RiichiSeat {
  /** The declaration discard (shown sideways). */
  tile: TileId;
  double: boolean;
  ippatsu: boolean;
  /** The 1000-point stick is on the table (the declaration discard went through). */
  paid: boolean;
}

/** American Charleston: stages 0 R, 1 A, 2 L, 3 vote, 4 L, 5 A, 6 R, 7 courtesy (across). */
export interface Charleston {
  stage: number;
  picks: (TileId[] | null)[];
  votes: (boolean | null)[];
}

export type HandEvent =
  | { t: 'bonus'; seat: number; tile: TileId }
  /** `tsumogiri`: the tile thrown was the one just drawn. */
  | { t: 'discard'; seat: number; tile: TileId; tsumogiri?: boolean }
  | { t: 'riichi'; seat: number; tile: TileId }
  | { t: 'chi' | 'pong' | 'expose'; seat: number; from: number; tile: TileId }
  | { t: 'kong'; seat: number; how: 'exposed' | 'concealed' | 'added'; tile: TileId }
  | { t: 'swap'; seat: number; target: number }
  | { t: 'pass'; stage: number }
  | { t: 'win'; seat: number; from: number | null }
  | { t: 'abort'; why: string }
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
  /** Riichi: the dora / ura-dora indicators as they stood. */
  indicators?: TileId[];
  uraIndicators?: TileId[];
}

export interface HandResult {
  handNo: number;
  dealer: number;
  prevailing: number;
  wins: WinRecord[];
  deltas: number[];
  dealerStays: boolean;
  end: 'win' | 'exhausted' | 'abortive';
  /** Abortive draw: what ended it. */
  abort?: string;
  /** Riichi: who was ready at the exhaustive draw. */
  tenpai?: boolean[];
  notes: string[];
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
  phase: 'charleston' | 'act' | 'claim' | 'end';
  /** The tile the turn player just drew (null after a chow / pong). */
  drawn: TileId | null;
  /** How the turn player's current tile arrived. */
  drawKind: 'deal' | 'wall' | 'replacement' | 'claim';
  /** Kongs declared in a row this turn (2+ = 槓上槓 if the replacement wins). */
  kongChain: number;
  claim: ClaimWindow | null;
  lastDiscard: { tile: TileId; from: number } | null;
  /** Discards made this hand, and per seat. */
  discards: number;
  played: number[];
  /** Calls made this hand (chows, pongs, kongs — concealed ones too). */
  calls: number;
  log: HandEvent[];
  result: HandResult | null;
  ready: boolean[];
  // --- riichi
  riichi: (RiichiSeat | null)[];
  /** Temporary furiten (passed a winning tile; clears on the player's next discard). */
  furiten: boolean[];
  /** Riichi furiten: passed a winning tile after declaring — for the rest of the hand. */
  lockedFuriten: boolean[];
  /** Dora indicators showing. */
  dora: number;
  kans: number[];
  /** Kuikae: kinds the turn player may not discard right after a call. */
  forbidden: Kind[];
  // --- american
  charleston: Charleston | null;
}

export interface MatchState {
  v: 2;
  config: MatchConfig;
  rng: number;
  scores: number[];
  prevailing: number;
  dealer: number;
  /** Hands in a row the dealer has kept the deal (連莊). */
  streak: number;
  /** Riichi: honba counters. */
  honba: number;
  /** Riichi: 1000-point sticks waiting on the table. */
  sticks: number;
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
  | { type: 'discard'; seat: number; tile: TileId; riichi?: boolean }
  | { type: 'kong'; seat: number; kind: Kind }
  | { type: 'win'; seat: number }
  | { type: 'claim'; seat: number; claim: Claim }
  /** Riichi: 九種九牌, abort the hand on the first draw. */
  | { type: 'abort'; seat: number }
  /** American: trade a natural tile for the joker in an exposure. */
  | { type: 'swap'; seat: number; tile: TileId; target: { seat: number; order: number } }
  /** American Charleston: the tiles to pass (3, or 0–3 for the courtesy pass). */
  | { type: 'pass'; seat: number; tiles: TileId[] }
  /** American: play the second Charleston? */
  | { type: 'vote'; seat: number; yes: boolean }
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
const features = (s: MatchState) => variantOf(s).features;
/** Live tiles still drawable. */
export const liveLeft = (s: MatchState) => s.hand.tail - s.hand.head - variantOf(s).reserve(rulesOf(s));
const sortTiles = (tiles: TileId[]) => tiles.sort((a, b) => kindOf(a) - kindOf(b) || a - b);
const kinds = (tiles: readonly TileId[]) => tiles.map(kindOf);
const countOf = (tiles: readonly TileId[], k: Kind) => tiles.reduce((n, t) => n + (kindOf(t) === k ? 1 : 0), 0);
/** Forward distance in turn order from `from` to `to` (1–3). */
export const turnDistance = (from: number, to: number) => (to - from + 4) % 4 || 4;
const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;
/**
 * The next state's working copy. The config and finished hands' results are
 * never written after they're made, so they're shared instead of copied (the
 * history array itself is copied, so pushing to it leaves the input alone).
 */
function nextState(s: MatchState): MatchState {
  // Blank the shared fields in place (keeping the key order, which checksum() sees), copy, put them back.
  const out = clone({ ...s, config: null, history: null }) as unknown as MatchState;
  out.config = s.config;
  out.history = s.history.slice();
  return out;
}

function takeTiles(hand: TileId[], k: Kind, n: number): TileId[] {
  const out: TileId[] = [];
  for (let i = hand.length - 1; i >= 0 && out.length < n; i--) {
    if (kindOf(hand[i]!) === k) out.push(...hand.splice(i, 1));
  }
  if (out.length < n) throw new IllegalAction(`needs ${n} of kind ${k}`);
  return out;
}

export function meldFacts(p: Player): MeldFact[] {
  return p.melds.map((m) => ({ type: m.type, kind: m.kind, concealed: m.concealed, from: m.from, order: m.order, tiles: [...m.tiles] }));
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

/** Sets the concealed part of `seat`'s hand still has to make. */
export function setsNeeded(s: MatchState, seat: number): number {
  return (variantOf(s).handSize - 1) / 3 - s.hand.players[seat]!.melds.length;
}

/** 34-slot counts of a seat's concealed playing tiles. */
export function handCounts(s: MatchState, seat: number): number[] {
  const c = new Array<number>(34).fill(0);
  for (const t of s.hand.players[seat]!.hand) {
    const k = kindOf(t);
    if (k < 34) c[k]!++;
  }
  return c;
}

/** The kinds that would complete `seat`'s waiting hand (standard variants). */
export function seatWaits(s: MatchState, seat: number): Kind[] {
  const c = handCounts(s, seat);
  if (c.reduce((a, b) => a + b, 0) % 3 !== 1) return [];
  return waits(c, setsNeeded(s, seat), variantOf(s).shape(rulesOf(s)));
}

/** Riichi: the wall positions of the dora indicators (and the ura indicators under them). */
export function indicatorIds(s: MatchState): { dora: TileId[]; ura: TileId[] } {
  const h = s.hand;
  const L = h.wall.length;
  const dora: TileId[] = [];
  const ura: TileId[] = [];
  for (let i = 0; i < h.dora; i++) {
    dora.push(h.wall[L - 6 - 2 * i]!);
    ura.push(h.wall[L - 5 - 2 * i]!);
  }
  return { dora, ura };
}

// ------------------------------------------------------------ setup

export function createMatch(config: MatchConfig): MatchState {
  const variant = getVariant(config.variant);
  if (config.seats.length !== 4) throw new Error('A match needs four seats.');
  const rules = variant.normalizeRules(config.rules);
  const rng = new Rng(config.seed);
  const dealer = rng.int(4);
  const state: MatchState = {
    v: 2,
    config: clone({ ...config, rules }),
    rng: rng.state,
    scores: [0, 1, 2, 3].map(() => variant.startingScore(rules)),
    prevailing: 0,
    dealer,
    streak: 0,
    honba: 0,
    sticks: 0,
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
    .sort((a, b) => Number(isBonus(kindOf(b)) || kindOf(b) === JOKER) - Number(isBonus(kindOf(a)) || kindOf(a) === JOKER) || a - b);
  dealHand(state, [...front, ...rest, ...back.reverse()]);
  return state;
}

function dealHand(s: MatchState, fixedWall?: TileId[]): void {
  const variant = variantOf(s);
  const rng = new Rng(s.rng);
  const wall = fixedWall ?? rng.shuffle(tileIds(variant.tiles));
  // The dealer's dice pick whose wall is broken (counting the dealer as 1,
  // counter-clockwise) and how many stacks in from its right end. Stacks are
  // numbered clockwise around the table; see wallStacks().
  const dice: [number, number] = [rng.int(6) + 1, rng.int(6) + 1];
  const sum = dice[0] + dice[1];
  const stacks = Math.ceil(wall.length / 2);
  const owner = (s.dealer + sum - 1) % 4;
  const breakAt = (((4 - owner) % 4) * (stacks / 4) + sum) % stacks;
  s.rng = rng.state;
  const f = variant.features;
  s.hand = {
    wall,
    head: 0,
    tail: wall.length,
    breakAt,
    dice,
    players: [0, 1, 2, 3].map(() => ({ hand: [], melds: [], bonus: [], discards: [], gone: [] })),
    turn: s.dealer,
    phase: 'act',
    drawn: null,
    drawKind: 'deal',
    kongChain: 0,
    claim: null,
    lastDiscard: null,
    discards: 0,
    played: [0, 0, 0, 0],
    calls: 0,
    log: [],
    result: null,
    ready: [false, false, false, false],
    riichi: [null, null, null, null],
    furiten: [false, false, false, false],
    lockedFuriten: [false, false, false, false],
    dora: f.riichi ? 1 : 0,
    kans: [0, 0, 0, 0],
    forbidden: [],
    charleston: null,
  };
  const h = s.hand;
  // Deal in blocks of four, then the rest, starting with the dealer.
  const order = [0, 1, 2, 3].map((i) => (s.dealer + i) % 4);
  let dealt = 0;
  while (dealt < variant.handSize) {
    const n = Math.min(4, variant.handSize - dealt);
    for (const seat of order) for (let i = 0; i < n; i++) h.players[seat]!.hand.push(h.wall[h.head++]!);
    dealt += n;
  }
  if (f.bonus === 'setAside') {
    // Bonus tiles are set aside and replaced from the back, seat by seat.
    for (const seat of order) {
      const p = h.players[seat]!;
      while (h.phase !== 'end') {
        const i = p.hand.findIndex((t) => isBonus(kindOf(t)));
        if (i < 0) break;
        const [b] = p.hand.splice(i, 1);
        if (takeBonus(s, seat, b!)) break;
        p.hand.push(h.wall[--h.tail]!);
      }
      sortTiles(p.hand);
      if (h.phase === 'end') return;
    }
  }
  for (const p of h.players) sortTiles(p.hand);
  draw(s, s.dealer, 'deal');
  if (f.american && h.phase === 'act') {
    h.phase = 'charleston';
    h.charleston = { stage: 0, picks: [null, null, null, null], votes: [null, null, null, null] };
  }
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
  const reserve = variant.reserve(rulesOf(s));
  h.turn = seat;
  h.claim = null;
  h.forbidden = [];
  let fromBack = kind === 'replacement';
  for (;;) {
    if (h.tail - h.head <= reserve) return endExhausted(s);
    const tile = fromBack ? h.wall[--h.tail]! : h.wall[h.head++]!;
    if (variant.features.bonus === 'setAside' && isBonus(kindOf(tile))) {
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
  const settle = variantOf(s).exhausted?.(s);
  endHand(s, [], { end: 'exhausted', extra: settle?.deltas, tenpai: settle?.tenpai, notes: settle?.notes ?? [] });
}

function endAbortive(s: MatchState, why: string): void {
  s.hand.log.push({ t: 'abort', why });
  endHand(s, [], { end: 'abortive', abort: why, notes: [] });
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

/** A WinInput with neutral situational facts (AI planning, hints). */
export function blankWinInput(p: Partial<WinInput> & Pick<WinInput, 'seat' | 'concealed' | 'winTile' | 'melds'>): WinInput {
  return {
    seatWind: 0,
    prevailing: 0,
    dealer: 0,
    concealedIds: [],
    winTileId: null,
    bonus: [],
    selfDraw: false,
    from: null,
    robbingKong: false,
    lastTile: false,
    kongReplacement: 0,
    firstDraw: false,
    beforeFirstDraw: false,
    dealersFirstDiscard: false,
    flowerWin: null,
    wallLeft: 99,
    discardUnseen: false,
    riichi: 0,
    ippatsu: false,
    dora: [],
    uraDora: [],
    honba: 0,
    sticks: 0,
    streak: 0,
    ...p,
  };
}

function buildWinInput(s: MatchState, c: WinCtx, counters = { honba: 0, sticks: 0 }): WinInput {
  const h = s.hand;
  const p = h.players[c.seat]!;
  const concealedIds = [...p.hand];
  if (!c.selfDraw && c.tile !== null && !c.flowerWin) concealedIds.push(c.tile);
  const winTile = c.tile ?? p.hand[p.hand.length - 1] ?? null;
  const noCalls = h.calls === 0;
  const r = h.riichi[c.seat];
  const ind = indicatorIds(s);
  return {
    seat: c.seat,
    seatWind: seatWind(s, c.seat),
    prevailing: s.prevailing,
    dealer: s.dealer,
    concealed: kinds(concealedIds),
    concealedIds,
    winTile: winTile === null ? -1 : kindOf(winTile),
    winTileId: winTile,
    melds: meldFacts(p),
    bonus: kinds(p.bonus),
    selfDraw: c.selfDraw,
    from: c.from,
    robbingKong: c.robbingKong,
    lastTile: !c.flowerWin && !c.robbingKong && liveLeft(s) === 0,
    kongReplacement: c.selfDraw && h.drawKind === 'replacement' ? h.kongChain : 0,
    firstDraw: c.selfDraw && noCalls && h.played[c.seat] === 0 && (h.drawKind === 'deal' || h.drawKind === 'wall'),
    beforeFirstDraw: !c.selfDraw && !c.robbingKong && noCalls && h.played[c.seat] === 0 && c.seat !== s.dealer,
    dealersFirstDiscard: !c.selfDraw && !c.robbingKong && c.from === s.dealer && h.discards === 1 && noCalls,
    flowerWin: c.flowerWin,
    wallLeft: liveLeft(s),
    discardUnseen: !c.selfDraw && c.tile !== null && visibleCopies(s, kindOf(c.tile), c.tile) === 0,
    riichi: r ? (r.double ? 2 : 1) : 0,
    ippatsu: !!r?.ippatsu,
    dora: kinds(ind.dora).map(doraFromIndicator),
    uraDora: r ? kinds(ind.ura).map(doraFromIndicator) : [],
    honba: counters.honba,
    sticks: counters.sticks,
    streak: s.streak,
  };
}

/** Score a would-be win, or null when it isn't a legal one (shape, minimum, furiten). */
function legalWin(s: MatchState, c: WinCtx): WinScore | null {
  const variant = variantOf(s);
  if (variant.features.riichi && !c.selfDraw && isFuriten(s, c.seat)) return null;
  const input = buildWinInput(s, c);
  const score = variant.evaluate(input, rulesOf(s));
  return score && variant.canWin(score, rulesOf(s)) ? score : null;
}

/** Riichi furiten: a wait in the player's own discards, or a passed winning tile. */
export function isFuriten(s: MatchState, seat: number): boolean {
  const h = s.hand;
  if (h.furiten[seat] || h.lockedFuriten[seat]) return true;
  const gone = new Set(h.players[seat]!.gone.map(kindOf));
  return seatWaits(s, seat).some((k) => gone.has(k));
}

/** The copy of `kind` that `from` would throw: one from its hand, else one nobody can see (so 五子包生 reads right). */
function throwableId(s: MatchState, from: number, kind: Kind): TileId {
  const own = s.hand.players[from]!.hand.find((t) => kindOf(t) === kind);
  if (own !== undefined) return own;
  const seen = new Set(s.hand.players.flatMap((p) => [...p.discards, ...p.melds.flatMap((m) => m.tiles)]));
  const ids = [kind * 4, kind * 4 + 1, kind * 4 + 2, kind * 4 + 3];
  return ids.find((t) => !seen.has(t)) ?? ids[0]!;
}

const ronCtx = (s: MatchState, seat: number, from: number, kind: Kind): WinCtx => ({
  seat,
  from,
  tile: throwableId(s, from, kind),
  selfDraw: false,
  robbingKong: false,
  flowerWin: null,
});

/**
 * Could `seat` win (minimum faan and all) on a tile of `kind` discarded by
 * `from` right now? Reads `seat`'s hidden hand: training labels and analysis
 * only — never a player's decision.
 */
export function canRonOn(s: MatchState, seat: number, from: number, kind: Kind): boolean {
  if (seat === from || s.hand.players[seat]!.hand.length % 3 !== 1) return false;
  return legalWin(s, ronCtx(s, seat, from, kind)) !== null;
}

/**
 * What `from` discarding a tile of `kind` right now would hand out: the seats
 * that could win on it, the ones that would (after 截糊 / multi-win, as
 * tryResolve picks them, if all of them claimed), and what `from` would pay
 * them (包 included). Reads every hand — training labels and analysis only.
 */
export function dealInCost(s: MatchState, from: number, kind: Kind): { can: number[]; winners: number[]; cost: number } {
  const variant = variantOf(s);
  const can = [1, 2, 3].map((d) => (from + d) % 4).filter((seat) => canRonOn(s, seat, from, kind));
  if (can.length === 0) return { can, winners: [], cost: 0 };
  const winners = variant.multiWin(rulesOf(s)) === 'head' ? can.slice(0, 1) : can;
  let cost = 0;
  for (const seat of winners) {
    const input = buildWinInput(s, ronCtx(s, seat, from, kind));
    const score = variant.evaluate(input, rulesOf(s))!;
    cost -= variant.settle(input, score, rulesOf(s)).deltas[from]!;
  }
  return { can, winners, cost };
}

/** The score a winning tile would give `seat` right now (UI hints). */
export function previewWin(s: MatchState, seat: number, tile: TileId, selfDraw: boolean): WinScore | null {
  return legalWin(s, { seat, from: selfDraw ? null : s.hand.turn, tile, selfDraw, robbingKong: false, flowerWin: null });
}

function finishWins(s: MatchState, wins: WinCtx[]): void {
  const variant = variantOf(s);
  const h = s.hand;
  const records: WinRecord[] = [];
  const ind = indicatorIds(s);
  wins.forEach((c, i) => {
    // The first winner (nearest the discarder) collects the counters.
    const counters = i === 0 ? { honba: s.honba, sticks: s.sticks } : { honba: 0, sticks: 0 };
    const input = buildWinInput(s, c, counters);
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
      ...(variant.features.riichi ? { indicators: ind.dora, ...(h.riichi[c.seat] ? { uraIndicators: ind.ura } : {}) } : {}),
    });
    h.log.push({ t: 'win', seat: c.seat, from: c.from });
  });
  if (records.length > 0) s.sticks = 0;
  endHand(s, records, { end: 'win', notes: [] });
}

function endHand(
  s: MatchState,
  wins: WinRecord[],
  o: { end: HandResult['end']; abort?: string; extra?: number[] | undefined; tenpai?: boolean[] | undefined; notes: string[] },
): void {
  const h = s.hand;
  const deltas = [0, 0, 0, 0];
  for (const w of wins) w.settlement.deltas.forEach((d, i) => (deltas[i]! += d));
  o.extra?.forEach((d, i) => (deltas[i]! += d));
  deltas.forEach((d, i) => (s.scores[i]! += d));
  h.phase = 'end';
  h.claim = null;
  const result: HandResult = {
    handNo: s.handNo,
    dealer: s.dealer,
    prevailing: s.prevailing,
    wins,
    deltas,
    dealerStays: false,
    end: o.end,
    notes: o.notes,
    ...(o.abort ? { abort: o.abort } : {}),
    ...(o.tenpai ? { tenpai: o.tenpai } : {}),
  };
  result.dealerStays = variantOf(s).afterHand(s, result).dealerStays;
  h.result = result;
}

/** Rotate the deal after a finished hand; sets `over` when the match ends. */
function advance(s: MatchState): void {
  const result = s.hand.result!;
  const variant = variantOf(s);
  const next = variant.afterHand(s, result);
  s.history.push(result);
  s.honba = next.honba;
  if (next.dealerStays) {
    s.streak++;
  } else {
    s.dealer = (s.dealer + 1) % 4;
    s.streak = 0;
    s.passes++;
    if (s.passes % 4 === 0) s.prevailing++;
  }
  if (variant.matchOver(s)) {
    s.over = true;
    // Riichi sticks still on the table go to the leader.
    if (s.sticks > 0) {
      const top = s.scores.indexOf(Math.max(...s.scores));
      s.scores[top]! += s.sticks * 1000;
      s.sticks = 0;
    }
  }
}

function nextHand(s: MatchState): void {
  advance(s);
  if (s.over) return;
  s.handNo++;
  dealHand(s);
}

// ------------------------------------------------------------ legal moves

export interface TurnOptions {
  canDiscard: boolean;
  /** Tiles that may be discarded (null = any). */
  allowed: TileId[] | null;
  /** Riichi: discards that may declare riichi. */
  riichi: TileId[];
  /** Kinds this seat may kong now (concealed or added). */
  kongs: Kind[];
  /** Self-draw win available (the score it would make). */
  win: WinScore | null;
  /** Riichi: 九種九牌 abort available. */
  abort: boolean;
  /** American: joker exchanges available. */
  swaps: { tile: TileId; target: { seat: number; order: number } }[];
}

const NO_TURN: TurnOptions = { canDiscard: false, allowed: null, riichi: [], kongs: [], win: null, abort: false, swaps: [] };

function closedHand(p: Player): boolean {
  return p.melds.every((m) => m.concealed);
}

export function turnOptions(s: MatchState, seat: number): TurnOptions {
  const h = s.hand;
  if (s.over || h.phase !== 'act' || h.turn !== seat) return NO_TURN;
  const f = features(s);
  const p = h.players[seat]!;
  const r = h.riichi[seat];
  const counts = handCounts(s, seat);
  const sets = setsNeeded(s, seat);
  const shape = variantOf(s).shape(rulesOf(s));

  // Discards: after riichi only the drawn tile; after a call no kuikae swap.
  let allowed: TileId[] | null = null;
  if (r && h.drawn !== null) allowed = [h.drawn];
  else if (h.forbidden.length > 0) {
    const ok = p.hand.filter((t) => !h.forbidden.includes(kindOf(t)));
    if (ok.length > 0) allowed = ok;
  }

  const riichi: TileId[] = [];
  if (f.riichi && !r && closedHand(p) && s.scores[seat]! >= 1000 && liveLeft(s) >= 4 && h.drawKind !== 'claim') {
    const c = counts.slice();
    for (let k = 0; k < 34; k++) {
      if (c[k] === 0) continue;
      c[k]!--;
      if (shanten(c, sets, shape) === 0) riichi.push(...p.hand.filter((t) => kindOf(t) === k));
      c[k]!++;
    }
  }

  const kongs: Kind[] = [];
  const kanCap = f.riichi && h.kans.reduce((a, b) => a + b, 0) >= 4;
  if (f.kongs && liveLeft(s) > 0 && h.drawKind !== 'claim' && !kanCap) {
    const seen = new Set<Kind>();
    for (const t of p.hand) {
      const k = kindOf(t);
      if (seen.has(k)) continue;
      seen.add(k);
      if (r) {
        // After riichi: a concealed kong of the drawn tile that keeps the same waits.
        if (h.drawn !== null && kindOf(h.drawn) === k && countOf(p.hand, k) === 4) {
          const before = counts.slice();
          before[k]!--;
          const after = counts.slice();
          after[k] = 0;
          const w1 = waits(before, sets, shape).join();
          const w2 = waits(after, sets - 1, shape).join();
          if (w1 !== '' && w1 === w2) kongs.push(k);
        }
        continue;
      }
      if (countOf(p.hand, k) === 4) kongs.push(k);
      else if (p.melds.some((m) => m.type === 'pong' && m.kind === k)) kongs.push(k);
    }
  }

  const win =
    h.drawKind !== 'claim' && (h.drawn !== null || h.drawKind === 'deal')
      ? legalWin(s, { seat, from: null, tile: h.drawn, selfDraw: true, robbingKong: false, flowerWin: null })
      : null;

  const abort =
    f.riichi &&
    h.calls === 0 &&
    h.played[seat] === 0 &&
    (h.drawKind === 'deal' || h.drawKind === 'wall') &&
    ORPHANS.filter((k) => counts[k]! > 0).length >= 9;

  const swaps = f.american ? american.jokerSwaps(s, seat) : [];
  return { canDiscard: true, allowed, riichi, kongs, win, abort, swaps };
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
  const f = features(s);
  if (f.american) return american.claimOptions(s, seat, tile, from);
  const p = h.players[seat]!;
  const k = kindOf(tile);
  const out: Claim[] = [];
  if (legalWin(s, { seat, from, tile, selfDraw: false, robbingKong: false, flowerWin: null })) out.push({ type: 'win' });
  // Off the last tile only a win may be claimed; a riichi hand may only win.
  if (liveLeft(s) > 0 && !h.riichi[seat]) {
    const n = countOf(p.hand, k);
    if (n >= 2) out.push({ type: 'pong' });
    const kanCap = f.riichi && h.kans.reduce((a, b) => a + b, 0) >= 4;
    if (n >= 3 && f.kongs && !kanCap) out.push({ type: 'kong' });
    if (f.chi === 'left' && seat === (from + 1) % 4) {
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
  if (h.phase === 'charleston') {
    const c = h.charleston!;
    return [0, 1, 2, 3].filter((i) => (c.stage === 3 ? c.votes[i] === null : c.picks[i] === null));
  }
  if (h.phase === 'act') return [h.turn];
  if (h.phase === 'claim') return [0, 1, 2, 3].filter((i) => h.claim!.responses[i] === null);
  return [0, 1, 2, 3].filter((i) => !h.ready[i]);
}

// ------------------------------------------------------------ claims

const PRIORITY = { pass: 0, chi: 1, pong: 2, kong: 2, expose: 2, win: 3 } as const;

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
  const deadJoker = features(s).american && kindOf(tile) === JOKER;
  const options = [0, 1, 2, 3].map((seat) => (seat === from || deadJoker ? [] : discardClaims(s, seat, tile, from)));
  if (!openClaimWindow(s, 'discard', tile, from, options)) {
    if (!discardPassed(s, tile, from)) nextTurn(s, from);
  }
}

/**
 * A discard (or an added kong's tile) went by without a win. Riichi
 * bookkeeping: furiten for whoever was waiting on it, the declaration stick,
 * and the abortive draws. Returns true when it ended the hand.
 */
function discardPassed(s: MatchState, tile: TileId, from: number, isDiscard = true): boolean {
  const h = s.hand;
  if (!features(s).riichi) return false;
  const k = kindOf(tile);
  for (let seat = 0; seat < 4; seat++) {
    if (seat === from) continue;
    if (seatWaits(s, seat).includes(k)) {
      h.furiten[seat] = true;
      if (h.riichi[seat]) h.lockedFuriten[seat] = true;
    }
  }
  if (!isDiscard) return false;
  const r = h.riichi[from];
  if (r && !r.paid && r.tile === tile) {
    r.paid = true;
    s.scores[from]! -= 1000;
    s.sticks++;
  }
  // 四風連打: all four first discards the same wind.
  if (h.discards === 4 && h.calls === 0) {
    const firsts = h.players.map((p) => p.gone[0]);
    if (firsts.every((t) => t !== undefined && isWind(kindOf(t)) && kindOf(t) === kindOf(firsts[0]!))) {
      endAbortive(s, '四風連打 · four winds');
      return true;
    }
  }
  // 四家立直: all four declared riichi.
  if (h.riichi.every((x) => x?.paid)) {
    endAbortive(s, '四家立直 · four riichi');
    return true;
  }
  // 四槓散了: four kongs, not all by one player.
  const totalKans = h.kans.reduce((a, b) => a + b, 0);
  if (totalKans >= 4 && Math.max(...h.kans) < 4) {
    endAbortive(s, '四槓散了 · four kongs');
    return true;
  }
  return false;
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
  const mode = variantOf(s).multiWin(rulesOf(s));
  const multi = mode !== 'head';
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
    if (mode === 'double' && winners.length === 3) return endAbortive(s, '三家和 · triple ron');
    const chosen = multi ? winners : winners.slice(0, 1);
    if (c.kind === 'robKong') unKong(s, c.from, c.tile);
    finishWins(
      s,
      chosen.map((seat) => ({ seat, from: c.from, tile: c.tile, selfDraw: false, robbingKong: c.kind === 'robKong', flowerWin: null })),
    );
    return;
  }
  if (discardPassed(s, c.tile, c.from, c.kind === 'discard')) return;
  if (c.kind === 'robKong') {
    // Nobody robbed: the kong stands and the konger draws its replacement.
    s.hand.claim = null;
    draw(s, c.from, 'replacement');
    return;
  }
  if (!top) return nextTurn(s, c.from);
  applyClaim(s, top.seat, top.claim, c.tile, c.from);
}

function breakIppatsu(s: MatchState): void {
  for (const r of s.hand.riichi) if (r) r.ippatsu = false;
}

function applyClaim(s: MatchState, seat: number, claim: Claim, tile: TileId, from: number): void {
  const h = s.hand;
  const p = h.players[seat]!;
  const k = kindOf(tile);
  h.players[from]!.discards.pop();
  h.calls++;
  h.claim = null;
  h.lastDiscard = null;
  breakIppatsu(s);
  if (claim.type === 'expose') {
    american.applyExpose(s, seat, claim, tile, from);
    h.log.push({ t: 'expose', seat, from, tile });
  } else {
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
    if (type === 'kong') {
      h.log.push({ t: 'kong', seat, how: 'exposed', tile });
      h.kongChain = 1;
      h.kans[seat]!++;
      if (features(s).riichi) h.dora = Math.min(5, h.dora + 1);
      draw(s, seat, 'replacement');
      return;
    }
    h.log.push({ t: type, seat, from, tile });
    // Kuikae: don't throw back what you just called (or its other end of the chow).
    if (features(s).riichi) {
      const forbidden = [k];
      if (type === 'chi') {
        if (claim.type === 'chi' && claim.low === k && k % 9 <= 5) forbidden.push(k + 3);
        if (claim.type === 'chi' && claim.low + 2 === k && k % 9 >= 3) forbidden.push(k - 3);
      }
      h.forbidden = forbidden;
    }
  }
  h.turn = seat;
  h.phase = 'act';
  h.drawn = null;
  h.drawKind = 'claim';
  h.kongChain = 0;
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
      if (thirteenOnly && !score.items.some((i) => i.id === 'thirteenOrphans' || i.id === 'kokushi')) return [];
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
    options = variant.features.robKong ? robbers(false) : [[], [], [], []];
  }
  h.kongChain++;
  h.kans[seat]!++;
  h.calls++;
  breakIppatsu(s);
  if (variant.features.riichi) h.dora = Math.min(5, h.dora + 1);
  h.drawn = null;
  if (!openClaimWindow(s, 'robKong', tile, seat, options)) draw(s, seat, 'replacement');
}

// ------------------------------------------------------------ the Charleston

const CHARLESTON_DIR = [1, 2, 3, 0, 3, 2, 1, 2]; // seats to the right / across / left

/** What the Charleston wants from `seat` now: a pass of `count` tiles, or a vote. */
export function charlestonAsk(s: MatchState, seat: number): { kind: 'pass'; min: number; max: number; to: number } | { kind: 'vote' } | null {
  const c = s.hand.charleston;
  if (s.hand.phase !== 'charleston' || !c) return null;
  if (c.stage === 3) return c.votes[seat] === null ? { kind: 'vote' } : null;
  if (c.picks[seat] !== null) return null;
  const to = (seat + CHARLESTON_DIR[c.stage]!) % 4;
  return c.stage === 7 ? { kind: 'pass', min: 0, max: 3, to } : { kind: 'pass', min: 3, max: 3, to };
}

function charlestonStep(s: MatchState): void {
  const h = s.hand;
  const c = h.charleston!;
  const rules = rulesOf(s) as american.AmericanRules;
  if (c.stage === 3) {
    if (c.votes.some((v) => v === null)) return;
    c.stage = c.votes.every(Boolean) ? 4 : 7;
    if (c.stage === 7 && !rules.courtesyPass) return endCharleston(s);
    return;
  }
  if (c.picks.some((p) => p === null)) return;
  const picks = c.picks as TileId[][];
  const give: TileId[][] = picks.map((x) => [...x]);
  if (c.stage === 7) {
    // Courtesy pass: partners across trade the smaller of the two counts.
    for (const [a, b] of [
      [0, 2],
      [1, 3],
    ] as const) {
      const n = Math.min(picks[a]!.length, picks[b]!.length);
      give[a] = picks[a]!.slice(0, n);
      give[b] = picks[b]!.slice(0, n);
    }
  }
  for (let seat = 0; seat < 4; seat++) {
    const hand = h.players[seat]!.hand;
    for (const t of give[seat]!) hand.splice(hand.indexOf(t), 1);
  }
  for (let seat = 0; seat < 4; seat++) {
    const to = (seat + CHARLESTON_DIR[c.stage]!) % 4;
    h.players[to]!.hand.push(...give[seat]!);
  }
  for (const p of h.players) sortTiles(p.hand);
  h.log.push({ t: 'pass', stage: c.stage });
  c.picks = [null, null, null, null];
  if (c.stage === 2) {
    if (rules.secondCharleston) c.stage = 3;
    else if (rules.courtesyPass) c.stage = 7;
    else return endCharleston(s);
  } else if (c.stage === 6) {
    if (rules.courtesyPass) c.stage = 7;
    else return endCharleston(s);
  } else if (c.stage === 7) {
    return endCharleston(s);
  } else {
    c.stage++;
  }
}

function endCharleston(s: MatchState): void {
  const h = s.hand;
  h.charleston = null;
  h.phase = 'act';
  h.turn = s.dealer;
  h.drawn = null;
  h.drawKind = 'deal';
}

// ------------------------------------------------------------ the reducer

function sameClaim(a: Claim, b: Claim): boolean {
  if (a.type !== b.type) return false;
  if (a.type === 'chi') return b.type === 'chi' && a.low === b.low;
  if (a.type === 'expose') return b.type === 'expose' && a.size === b.size && a.jokers === b.jokers;
  return true;
}

/** Apply `action`; throws IllegalAction when it isn't legal right now. Never mutates `state`. */
export function applyAction(state: MatchState, action: Action): MatchState {
  if (state.over) throw new IllegalAction('the match is over');
  const s = nextState(state);
  const h = s.hand;
  const seat = action.seat;
  if (!(seat >= 0 && seat < 4)) throw new IllegalAction('no such seat');
  switch (action.type) {
    case 'discard': {
      if (h.phase !== 'act' || h.turn !== seat) throw new IllegalAction('not your turn to discard');
      const opts = turnOptions(state, seat);
      const p = h.players[seat]!;
      const i = p.hand.indexOf(action.tile);
      if (i < 0) throw new IllegalAction("that tile isn't in your hand");
      if (opts.allowed && !opts.allowed.includes(action.tile)) throw new IllegalAction("you can't discard that now");
      if (action.riichi) {
        if (!opts.riichi.includes(action.tile)) throw new IllegalAction("can't declare riichi with that");
        h.riichi[seat] = { tile: action.tile, double: h.played[seat] === 0 && h.calls === 0, ippatsu: true, paid: false };
        h.log.push({ t: 'riichi', seat, tile: action.tile });
      } else if (h.riichi[seat]) {
        h.riichi[seat]!.ippatsu = false;
      }
      const tsumogiri = action.tile === h.drawn;
      p.hand.splice(i, 1);
      p.discards.push(action.tile);
      p.gone.push(action.tile);
      h.discards++;
      h.played[seat]!++;
      h.furiten[seat] = false;
      h.forbidden = [];
      h.drawn = null;
      h.lastDiscard = { tile: action.tile, from: seat };
      h.log.push({ t: 'discard', seat, tile: action.tile, ...(tsumogiri ? { tsumogiri: true } : {}) });
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
    case 'abort': {
      if (!turnOptions(state, seat).abort) throw new IllegalAction("can't abort now");
      endAbortive(s, '九種九牌 · nine terminals');
      break;
    }
    case 'swap': {
      const ok = turnOptions(state, seat).swaps.some((x) => x.tile === action.tile && x.target.seat === action.target.seat && x.target.order === action.target.order);
      if (!ok) throw new IllegalAction("can't swap that");
      american.applySwap(s, seat, action.tile, action.target);
      h.log.push({ t: 'swap', seat, target: action.target.seat });
      break;
    }
    case 'pass': {
      const ask = charlestonAsk(state, seat);
      if (!ask || ask.kind !== 'pass') throw new IllegalAction('nothing to pass now');
      const tiles = action.tiles;
      const hand = h.players[seat]!.hand;
      if (tiles.length < ask.min || tiles.length > ask.max || new Set(tiles).size !== tiles.length) throw new IllegalAction(`pass ${ask.min}–${ask.max} tiles`);
      if (tiles.some((t) => !hand.includes(t) || kindOf(t) === JOKER)) throw new IllegalAction("can't pass those (jokers never pass)");
      h.charleston!.picks[seat] = [...tiles];
      charlestonStep(s);
      break;
    }
    case 'vote': {
      const ask = charlestonAsk(state, seat);
      if (!ask || ask.kind !== 'vote') throw new IllegalAction('nothing to vote on');
      h.charleston!.votes[seat] = action.yes;
      charlestonStep(s);
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
  for (const t of indicatorIds(s).dora) add(t);
  return c;
}

/** Discard analysis for the turn player (hints). */
export function discardHints(s: MatchState, seat: number) {
  return analyzeDiscards(handCounts(s, seat), setsNeeded(s, seat), visibleCounts(s, seat), variantOf(s).shape(rulesOf(s)));
}

/**
 * The wall in front of `seat` as its owner sees it, left to right: each stack's
 * tiles still in the wall (bottom first), and which of them show face up (dora
 * indicators). Live draws eat stacks clockwise from the break; replacement
 * draws take the other end.
 */
export function wallStacks(s: MatchState, seat: number): { ids: TileId[]; up: TileId[] }[] {
  const h = s.hand;
  const stacks = Math.ceil(h.wall.length / 2);
  const per = stacks / 4;
  const side = (4 - seat) % 4;
  const up = new Set(indicatorIds(s).dora);
  const out: { ids: TileId[]; up: TileId[] }[] = [];
  for (let pos = 0; pos < per; pos++) {
    const q = side * per + (per - 1 - pos);
    const m = (q - h.breakAt + stacks) % stacks;
    const ids = [2 * m + 1, 2 * m].filter((j) => j >= h.head && j < h.tail && j < h.wall.length).map((j) => h.wall[j]!);
    out.push({ ids, up: ids.filter((t) => up.has(t)) });
  }
  return out;
}

/** Will the match end once the current (finished) hand is confirmed? */
export function isFinalHand(s: MatchState): boolean {
  if (!s.hand.result) return false;
  const c = nextState(s);
  advance(c);
  return c.over;
}
