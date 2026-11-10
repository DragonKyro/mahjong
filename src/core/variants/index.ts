// The multi-variant framework. A variant is a rule set the shared table
// engine (engine.ts) plays: which tiles are in the wall, how many tiles a hand
// holds, which claims and mechanics exist (feature flags), and — through the
// hooks below — what counts as a win, what it scores, who pays, what happens
// on a draw, when the deal passes and when the match ends.
//
// The engine owns everything variants share (wall, deal, draw / discard /
// claim loop, kongs, bonus tiles, robbing a kong, dealer rotation) plus the
// flagged mechanics (riichi / furiten / dora, the Charleston and jokers), so a
// variant file is its rules, scoring and settlement.

import type { HandResult, MatchState } from '../engine';
import type { ShapeOptions } from '../hand';
import type { Kind, TileId, TileSetSpec } from '../tiles';
import { AMERICAN_VARIANT, type AmericanRules } from './american';
import { HK_VARIANT, type HkRules } from './hk';
import { RIICHI_VARIANT, type RiichiRules } from './riichi';
import { TAIWAN_VARIANT, type TaiwanRules } from './taiwan';

export type VariantId = 'hk' | 'taiwan' | 'riichi' | 'american';

/** A declared meld as scoring sees it. */
export interface MeldFact {
  /** 'set': an American exposure (3–6 alike, jokers allowed). */
  type: 'chi' | 'pong' | 'kong' | 'set';
  /** Pong / kong / set: its kind. Chi: its lowest kind. */
  kind: Kind;
  /** Only a concealed kong (暗槓) is concealed; every claimed meld is open. */
  concealed: boolean;
  /** Seat whose discard made it (null for a concealed kong). Added kongs keep the pong's source. */
  from: number | null;
  /** 0-based order in which the player declared it. */
  order: number;
  tiles: TileId[];
}

/** Everything a variant needs to judge and score one winning hand. */
export interface WinInput {
  seat: number;
  /** 0 = East … 3 = North. */
  seatWind: number;
  prevailing: number;
  dealer: number;
  /** Concealed kinds, winning tile included (jokers = 42, bonus kinds stay 34–41). */
  concealed: Kind[];
  concealedIds: TileId[];
  winTile: Kind;
  winTileId: TileId | null;
  melds: MeldFact[];
  /** Bonus tiles set aside (HK / Taiwan). */
  bonus: Kind[];
  selfDraw: boolean;
  /** Who fed the win: discarder, robbed konger or 8th-flower drawer. Null on self-draw. */
  from: number | null;
  robbingKong: boolean;
  /** Last tile of the wall (self-draw) or the discard after it. */
  lastTile: boolean;
  /** Kongs declared in a row before this replacement draw (0 = not a kong draw). */
  kongReplacement: number;
  /** Self-drawn on the player's first draw, nobody having called yet (天胡 / 地胡 / tenhou / chiihou). */
  firstDraw: boolean;
  /** Won off a discard before the player's own first draw, nobody having called (人胡 / renhou). */
  beforeFirstDraw: boolean;
  /** Won off the dealer's very first discard (HK 地糊). */
  dealersFirstDiscard: boolean;
  /** A bonus-tile win with no hand at all. */
  flowerWin: 'eight' | 'sevenRobOne' | null;
  /** Live wall tiles left when the winning tile was discarded / drawn. */
  wallLeft: number;
  /** No other copy of the winning discard was visible (discards, melds) before it. */
  discardUnseen: boolean;
  /** Riichi: 0 none, 1 riichi, 2 double riichi. */
  riichi: 0 | 1 | 2;
  ippatsu: boolean;
  /** Dora kinds (one entry per indicator) and ura-dora kinds (riichi winners only). */
  dora: Kind[];
  uraDora: Kind[];
  /** Counters paid to this winner (the first winner when several win). */
  honba: number;
  sticks: number;
  /** Hands in a row the dealer has kept the deal (Taiwan 連莊). */
  streak: number;
}

export interface ScoreItem {
  id: string;
  zh: string;
  en: string;
  value: number;
}

export interface WinScore {
  /** The variant's scoring units after any cap (faan / tai / han / card value). */
  value: number;
  /** Before the cap. */
  raw: number;
  /** A limit hand (爆棚 / mangan and up / yakuman). */
  limit: boolean;
  items: ScoreItem[];
  /** One line for the result card, e.g. "3 han 40 fu · 5,200" or "8 台". */
  summary: string;
  /** Riichi only. */
  han?: number;
  fu?: number;
}

export interface Settlement {
  /** Change to each physical seat's score. Sums to zero (counter sticks aside). */
  deltas: number[];
  /** Table points the hand was worth. */
  points: number;
  /** A seat that paid for everyone under a liability (包 / pao) rule. */
  liable: number | null;
  liabilityRule: string | null;
}

/** What happens to the scores when the wall runs out (Riichi: noten payments). */
export interface DrawSettlement {
  deltas: number[];
  tenpai?: boolean[];
  notes: string[];
}

/** Words the table uses for this variant's calls. */
export interface Terms {
  ron: string;
  tsumo: string;
  pong: string;
  kong: string;
  chi: string;
  pass: string;
  riichi?: string;
}

export interface Features {
  /** Bonus tiles: set aside and replaced (HK, Taiwan), ordinary tiles (American), or none (Riichi). */
  bonus: 'setAside' | 'tiles' | 'none';
  chi: 'left' | 'none';
  /** Kongs with replacement draws (not American). */
  kongs: boolean;
  robKong: boolean;
  /** Riichi, furiten, dora, kuikae, honba, abortive draws. */
  riichi: boolean;
  /** Charleston, jokers, exposures matched against a hand card. */
  american: boolean;
}

/** What every registered variant describes. */
export interface VariantInfo {
  id: VariantId;
  name: string;
  zh: string;
  region: string;
  status: 'playable' | 'planned';
  blurb: string;
  highlights: string[];
  tiles: TileSetSpec;
  /** Tiles in a hand before the draw (13, or 16 in Taiwan). */
  handSize: number;
  /** Scoring unit, e.g. 番 faan / 台 tai / 翻 han. */
  unit: { zh: string; en: string };
  terms: Terms;
}

/** The rule hooks the engine calls. `R` is the variant's own (JSON) rules object. */
export interface Variant<R> extends VariantInfo {
  status: 'playable';
  defaultRules: R;
  normalizeRules(rules: unknown): R;
  features: Features;
  /** Tiles left unplayed at the end of the wall (a draw is called when only these remain). */
  reserve(rules: R): number;
  shape(rules: R): ShapeOptions;
  /** Score a hand; null when it isn't a winning shape at all. */
  evaluate(input: WinInput, rules: R): WinScore | null;
  /** May a scored hand win (minimum faan, a yaku…)? */
  canWin(score: WinScore, rules: R): boolean;
  settle(input: WinInput, score: WinScore, rules: R): Settlement;
  /** The wall ran out. Default: nobody pays. */
  exhausted?(s: MatchState): DrawSettlement;
  /** After a hand: does the dealer keep the deal, and the next counter value. */
  afterHand(s: MatchState, result: HandResult): { dealerStays: boolean; honba: number };
  /** After rotating: is the match over? */
  matchOver(s: MatchState): boolean;
  /** Several players winning on one discard: head bump, everyone, or up to two (three = abortive). */
  multiWin(rules: R): 'head' | 'all' | 'double';
  flowerWins(rules: R): boolean;
  /** May 十三么 / kokushi rob a concealed kong? */
  robConcealedKong(rules: R): boolean;
  startingScore(rules: R): number;
  /** Minimum units to win, for the AI's planning. */
  minimum(rules: R): number;
}

export type AnyRules = HkRules | TaiwanRules | RiichiRules | AmericanRules;
// The engine holds one variant at a time and only ever passes it its own rules.
// eslint-style escape: the rules type is chosen at runtime by `variant.id`.
export type PlayableVariant = Variant<AnyRules>;

export const VARIANTS: readonly VariantInfo[] = [HK_VARIANT, TAIWAN_VARIANT, RIICHI_VARIANT, AMERICAN_VARIANT];

const BY_ID: Record<VariantId, unknown> = { hk: HK_VARIANT, taiwan: TAIWAN_VARIANT, riichi: RIICHI_VARIANT, american: AMERICAN_VARIANT };

export function getVariant(id: VariantId): PlayableVariant {
  const v = BY_ID[id];
  if (!v) throw new Error(`Unknown variant ${id}`);
  // reason: each variant is typed on its own rules; the engine pairs them by id.
  return v as PlayableVariant;
}

export function defaultRulesFor(id: VariantId): AnyRules {
  return getVariant(id).defaultRules;
}

/** Fill in a variant's rules (from storage or the lobby) with defaults. */
export function normalizeRulesFor(id: VariantId, rules: unknown): AnyRules {
  return getVariant(id).normalizeRules(rules);
}

/** Next tile in dora order: 9→1 in a suit, E→S→W→N→E, 白→發→中→白. */
export function doraFromIndicator(k: Kind): Kind {
  if (k < 27) return Math.floor(k / 9) * 9 + ((k % 9) + 1) % 9;
  if (k < 31) return 27 + ((k - 27 + 1) % 4);
  return 31 + ((k - 31 + 1) % 3);
}
