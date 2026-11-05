// The multi-variant framework. A variant is a rule set the shared table
// engine (engine.ts) plays: which tiles are in the wall, how many tiles a hand
// holds, which claims exist, and — through the hooks below — what counts as a
// win, what it scores, who pays, and when the deal passes.
//
// The engine owns everything variants share (wall, deal, draw / discard /
// claim loop, kongs, bonus-tile replacement, robbing a kong, dealer rotation),
// so adding a variant means writing its rules file and registering it here.
// Only Hong Kong Old Style is playable today; the others are registered as
// `planned` with their rule summaries, and `needs` lists what the engine still
// has to grow for each (e.g. Riichi's riichi declarations, American's Charleston).

import type { ShapeOptions } from '../hand';
import type { Kind, TileSetSpec } from '../tiles';
import { HK_VARIANT, type HkRules } from './hk';

export type VariantId = 'hk' | 'taiwan' | 'riichi' | 'american';

/** A declared meld as scoring sees it. */
export interface MeldFact {
  type: 'chi' | 'pong' | 'kong';
  /** Pong / kong: its kind. Chi: its lowest kind. */
  kind: Kind;
  /** Only a concealed kong (暗槓) is concealed; every claimed meld is open. */
  concealed: boolean;
  /** Seat whose discard made it (null for a concealed kong). Added kongs keep the pong's source. */
  from: number | null;
  /** 0-based order in which the player declared it. */
  order: number;
}

/** Everything a variant needs to judge and score one winning hand. */
export interface WinInput {
  seat: number;
  /** 0 = East … 3 = North. */
  seatWind: number;
  prevailing: number;
  dealer: number;
  /** Concealed kinds, winning tile included. */
  concealed: Kind[];
  winTile: Kind;
  melds: MeldFact[];
  bonus: Kind[];
  selfDraw: boolean;
  /** Who fed the win: discarder, robbed konger or 8th-flower drawer. Null on self-draw. */
  from: number | null;
  robbingKong: boolean;
  /** Last tile of the wall (self-draw) or the discard after it. */
  lastTile: boolean;
  /** Kongs declared in a row before this replacement draw (0 = not a kong draw). */
  kongReplacement: number;
  heavenly: boolean;
  earthly: boolean;
  /** A bonus-tile win with no hand at all. */
  flowerWin: 'eight' | 'sevenRobOne' | null;
  /** Live wall tiles left when the winning tile was discarded / drawn. */
  wallLeft: number;
  /** No other copy of the winning discard was visible (discards, melds) before it. */
  discardUnseen: boolean;
}

export interface ScoreItem {
  id: string;
  zh: string;
  en: string;
  value: number;
}

export interface WinScore {
  /** Scoring units after the cap (faan for HK). */
  value: number;
  /** Before the cap. */
  raw: number;
  /** A limit hand (爆棚 / 滿糊). */
  limit: boolean;
  items: ScoreItem[];
}

export interface Settlement {
  /** Change to each physical seat's score. Sums to zero. */
  deltas: number[];
  /** Table points the hand was worth. */
  points: number;
  /** A seat that paid for everyone under a liability (包) rule. */
  liable: number | null;
  liabilityRule: string | null;
}

/** What every registered variant describes, playable or not. */
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
  /** Tiles left unplayed at the end of the wall (a draw is called when only these remain). */
  reserve: number;
  /** Scoring unit, e.g. 番 faan / 台 tai / 翻 han. */
  unit: { zh: string; en: string };
  /** For planned variants: what the framework still has to add. */
  needs?: string[];
}

/** The rule hooks the engine calls. `R` is the variant's own (JSON) rules object. */
export interface Variant<R> extends VariantInfo {
  status: 'playable';
  defaultRules: R;
  claims: { chi: 'left' | 'none'; robKong: boolean };
  shape(rules: R): ShapeOptions;
  /** Score a hand; null when it isn't a winning shape at all. */
  evaluate(input: WinInput, rules: R): WinScore | null;
  /** Is a scored hand allowed to win (minimum faan etc.)? */
  canWin(score: WinScore, rules: R): boolean;
  settle(input: WinInput, score: WinScore, rules: R): Settlement;
  /** After a hand: does the dealer keep the deal? */
  dealerStays(winners: readonly number[], dealer: number, rules: R): boolean;
  /** Prevailing-wind rounds in a match (1 = East only … 4 = a full game). */
  rounds(rules: R): number;
  multiWin(rules: R): boolean;
  flowerWins(rules: R): boolean;
  /** May 十三么 rob a concealed kong? */
  robConcealedKong(rules: R): boolean;
  /** Points each seat starts with. */
  startingScore(rules: R): number;
}

/** Rules objects of the playable variants (extend as variants come online). */
export type AnyRules = HkRules;
export type PlayableVariant = Variant<AnyRules>;

const TAIWAN: VariantInfo = {
  id: 'taiwan',
  name: 'Taiwanese 16-tile',
  zh: '台灣十六張',
  region: 'Taiwan',
  status: 'planned',
  blurb: 'Sixteen-tile hands (five sets and a pair), scored in tai on top of a base stake, with a big dealer bonus.',
  highlights: [
    '16-tile hands: five sets plus a pair',
    'No minimum — any complete hand wins; 台 add to a base stake',
    'Dealer (莊) and dealer streaks (連莊) score extra tai',
    'The last 16 tiles of the wall are never drawn',
    'Flowers score for their seat; all eight win outright',
  ],
  tiles: { bonus: 8, jokers: 0 },
  handSize: 16,
  reserve: 16,
  unit: { zh: '台', en: 'tai' },
  needs: ['Tai table and base + tai settlement', 'Dealer-streak (連莊拉莊) bonus', 'Taiwan-specific hands (e.g. 嚦咕嚦咕, 獨聽)'],
};

const RIICHI: VariantInfo = {
  id: 'riichi',
  name: 'Japanese Riichi',
  zh: '日本麻雀',
  region: 'Japan',
  status: 'planned',
  blurb: 'No flowers, red fives and dora; every win needs a yaku, and a closed tenpai hand can declare riichi.',
  highlights: [
    '136 tiles plus red fives; a 14-tile dead wall with dora indicators',
    'At least one yaku to win; han and fu set the points',
    'Riichi declarations, furiten, and multiple ron',
    'Honba counters and tenpai payments on an exhaustive draw',
    'Played from 25,000 points over an East or East–South game',
  ],
  tiles: { bonus: 0, jokers: 0, redFives: 3 },
  handSize: 13,
  reserve: 14,
  unit: { zh: '翻', en: 'han' },
  needs: [
    'Riichi declaration and furiten in the turn loop',
    'Dora indicators and the dead wall',
    'Yaku + fu scoring and the han/fu point table',
    'Exhaustive-draw tenpai payments, abortive draws',
  ],
};

const AMERICAN: VariantInfo = {
  id: 'american',
  name: 'American',
  zh: '美式麻將',
  region: 'United States',
  status: 'planned',
  blurb: 'Jokers, the Charleston, and hands that must match a published card of patterns instead of sets and a pair.',
  highlights: [
    '152 tiles: 8 flowers and 8 jokers',
    'The Charleston: tiles are passed between players before play',
    'Only hands printed on the year’s card win; no chows',
    'Jokers stand in for tiles in groups of three or more',
    'Card hands carry their own values',
  ],
  tiles: { bonus: 8, jokers: 8 },
  handSize: 13,
  reserve: 0,
  unit: { zh: '分', en: 'points' },
  needs: [
    'The Charleston phase',
    'Jokers (and joker swaps from exposures)',
    'A hand-card pattern matcher (the yearly card is a published product, so the app would ship its own card or load one)',
  ],
};

export const VARIANTS: readonly VariantInfo[] = [HK_VARIANT, TAIWAN, RIICHI, AMERICAN];

export function getVariant(id: VariantId): PlayableVariant {
  if (id === 'hk') return HK_VARIANT;
  throw new Error(`The ${id} variant isn't playable yet.`);
}
