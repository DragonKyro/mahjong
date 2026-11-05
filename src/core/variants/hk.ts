// Hong Kong Old Style (香港舊章 / 廣東牌): rules, faan table, settlement.
//
// Faan values follow the common HK Old Style table (Wikipedia "Hong Kong
// mahjong scoring rules"): 3-faan minimum, limit hands at 10/13 faan capped by
// `maxFaan` (default 10, 十番爆棚), half-spicy points, discarder-pays-half
// (半銃) with the 包 liability rules. Every value and option is data in
// `HkRules`, so house rules are a config change, never a code change.

import { decompose, isSevenPairs, isThirteenOrphans, type Decomposition } from '../hand';
import {
  BONUS0,
  SEASON0,
  countKinds,
  isDragon,
  isHonor,
  isOrphan,
  isSuit,
  isWind,
  suitOf,
  windKind,
  type Kind,
} from '../tiles';
import type { ScoreItem, Settlement, Variant, WinInput, WinScore } from './index';

export type FaanId =
  | 'commonHand'
  | 'allTriplets'
  | 'mixedOneSuit'
  | 'allOneSuit'
  | 'mixedOrphans'
  | 'smallDragons'
  | 'greatDragons'
  | 'smallWinds'
  | 'sevenPairs'
  | 'allHonors'
  | 'fourConcealedPongs'
  | 'orphans'
  | 'nineGates'
  | 'greatWinds'
  | 'allKongs'
  | 'thirteenOrphans'
  | 'heavenly'
  | 'earthly'
  | 'eightFlowers'
  | 'sevenRobOne'
  | 'dragonPong'
  | 'seatWind'
  | 'prevailingWind'
  | 'noFlowers'
  | 'seatFlower'
  | 'flowerSet'
  | 'selfDraw'
  | 'concealed'
  | 'robbingKong'
  | 'lastTile'
  | 'kongWin'
  | 'doubleKongWin';

export type FaanGroup = 'hand' | 'limit' | 'honor' | 'bonus' | 'condition';

export interface FaanEntry {
  id: FaanId;
  zh: string;
  en: string;
  faan: number;
  group: FaanGroup;
  desc: string;
}

/** The default table. Order is display order (rules page, score breakdowns). */
export const FAAN_TABLE: readonly FaanEntry[] = [
  { id: 'commonHand', zh: '平糊', en: 'Common Hand', faan: 1, group: 'hand', desc: 'Every set is a chow (sequence).' },
  { id: 'allTriplets', zh: '對對糊', en: 'All Triplets', faan: 3, group: 'hand', desc: 'Every set is a pong or kong.' },
  { id: 'mixedOneSuit', zh: '混一色', en: 'Mixed One Suit', faan: 3, group: 'hand', desc: 'One suit plus honor tiles.' },
  { id: 'allOneSuit', zh: '清一色', en: 'All One Suit', faan: 7, group: 'hand', desc: 'Every tile from one suit, no honors.' },
  { id: 'mixedOrphans', zh: '花么九', en: 'Mixed Orphans', faan: 1, group: 'hand', desc: 'Only 1s, 9s and honors (so also All Triplets).' },
  { id: 'smallDragons', zh: '小三元', en: 'Small Three Dragons', faan: 5, group: 'hand', desc: 'Pongs of two dragons and a pair of the third (the dragon pongs included).' },
  { id: 'greatDragons', zh: '大三元', en: 'Great Three Dragons', faan: 8, group: 'hand', desc: 'Pongs of all three dragons (the dragon pongs included).' },
  { id: 'smallWinds', zh: '小四喜', en: 'Small Four Winds', faan: 6, group: 'hand', desc: 'Pongs of three winds and a pair of the fourth; seat / prevailing wind faan still add.' },
  { id: 'sevenPairs', zh: '七對子', en: 'Seven Pairs', faan: 4, group: 'hand', desc: 'Seven different pairs (house rule; off by default).' },
  { id: 'allHonors', zh: '字一色', en: 'All Honors', faan: 10, group: 'limit', desc: 'Only wind and dragon tiles.' },
  { id: 'fourConcealedPongs', zh: '坎坎糊', en: 'Four Concealed Pongs', faan: 10, group: 'limit', desc: 'Four concealed pongs / kongs; a discard may only complete the pair.' },
  { id: 'orphans', zh: '清么九', en: 'Orphans', faan: 10, group: 'limit', desc: 'Only 1s and 9s.' },
  { id: 'nineGates', zh: '九子連環', en: 'Nine Gates', faan: 10, group: 'limit', desc: 'Concealed 1112345678999 of one suit plus any tile of it.' },
  { id: 'greatWinds', zh: '大四喜', en: 'Great Four Winds', faan: 13, group: 'limit', desc: 'Pongs of all four winds.' },
  { id: 'allKongs', zh: '十八羅漢', en: 'All Kongs', faan: 13, group: 'limit', desc: 'Four kongs.' },
  { id: 'thirteenOrphans', zh: '十三么', en: 'Thirteen Orphans', faan: 13, group: 'limit', desc: 'One of every 1, 9, wind and dragon, plus a pair of one.' },
  { id: 'heavenly', zh: '天糊', en: 'Heavenly Hand', faan: 13, group: 'limit', desc: 'The dealer wins with the dealt hand.' },
  { id: 'earthly', zh: '地糊', en: 'Earthly Hand', faan: 13, group: 'limit', desc: "Winning on the dealer's first discard." },
  { id: 'eightFlowers', zh: '八仙過海', en: 'Eight Immortals', faan: 13, group: 'limit', desc: 'Holding all eight flowers and seasons wins at once.' },
  { id: 'sevenRobOne', zh: '七搶一', en: 'Seven Rob One', faan: 3, group: 'limit', desc: 'Holding seven bonus tiles, you take the eighth when another player draws it.' },
  { id: 'dragonPong', zh: '三元牌', en: 'Dragon Pong', faan: 1, group: 'honor', desc: 'Each pong / kong of 中, 發 or 白.' },
  { id: 'seatWind', zh: '門風', en: 'Seat Wind', faan: 1, group: 'honor', desc: 'A pong / kong of your own wind.' },
  { id: 'prevailingWind', zh: '圈風', en: 'Prevailing Wind', faan: 1, group: 'honor', desc: "A pong / kong of the round's wind (stacks with Seat Wind)." },
  { id: 'noFlowers', zh: '無花', en: 'No Flowers', faan: 1, group: 'bonus', desc: 'No flowers or seasons at all.' },
  { id: 'seatFlower', zh: '正花', en: 'Seat Flower', faan: 1, group: 'bonus', desc: 'Each flower or season of your seat (東1 南2 西3 北4).' },
  { id: 'flowerSet', zh: '一台花', en: 'Full Flower Set', faan: 2, group: 'bonus', desc: 'All four flowers, or all four seasons (replaces that set’s seat flower).' },
  { id: 'selfDraw', zh: '自摸', en: 'Self-Drawn', faan: 1, group: 'condition', desc: 'Drawing the winning tile yourself.' },
  { id: 'concealed', zh: '門前清', en: 'Concealed Hand', faan: 1, group: 'condition', desc: 'No melds claimed from discards (concealed kongs are fine).' },
  { id: 'robbingKong', zh: '搶槓', en: 'Robbing the Kong', faan: 1, group: 'condition', desc: 'Winning on the tile another player adds to a pong.' },
  { id: 'lastTile', zh: '海底撈月', en: 'Last Catch', faan: 1, group: 'condition', desc: 'Winning on the last wall tile or the discard after it.' },
  { id: 'kongWin', zh: '槓上開花', en: 'Win on a Kong', faan: 1, group: 'condition', desc: "Winning on a kong's replacement tile." },
  { id: 'doubleKongWin', zh: '槓上槓', en: 'Win on a Double Kong', faan: 8, group: 'condition', desc: 'Winning on the replacement of a kong made from a kong replacement.' },
];

const ENTRY = new Map(FAAN_TABLE.map((e) => [e.id, e]));

export interface HkRules {
  /** Minimum faan to win (三番起糊). 0 allows chicken hands (雞糊). */
  minFaan: number;
  /** Faan cap (爆棚): limit hands and big hands are paid at this many faan. */
  maxFaan: number;
  /** 半辣: points double every faan up to 4, then every two faan. 全辣: every faan. */
  spicy: 'half' | 'full';
  /** 半銃: the discarder pays half, the other two a quarter each. 全銃: the discarder pays all. */
  payment: 'halfGun' | 'fullGun';
  /** 包 rules (half-gun only): a player who fed a big hand pays for everyone. */
  liability: boolean;
  /** 七對子 counts as a winning hand. */
  sevenPairs: boolean;
  /** 八仙過海 and 七搶一. */
  flowerHands: boolean;
  /** 一炮多響: several players may win on one discard. Off = 截糊, the next in turn wins. */
  multiWin: boolean;
  /** The dealer keeps the deal after a drawn hand (流局連莊). */
  dealerStaysOnDraw: boolean;
  /** 十三么 may rob a concealed kong. */
  robConcealedKong: boolean;
  /** Prevailing-wind rounds: 1 東風 (one round), 2 東南, 4 a full game. */
  rounds: 1 | 2 | 4;
  /** Points every player starts with. */
  startingScore: number;
  /** Faan per entry (defaults from FAAN_TABLE). */
  faan: Record<FaanId, number>;
}

export const DEFAULT_HK_RULES: HkRules = {
  minFaan: 3,
  maxFaan: 10,
  spicy: 'half',
  payment: 'halfGun',
  liability: true,
  sevenPairs: false,
  flowerHands: true,
  multiWin: false,
  dealerStaysOnDraw: true,
  robConcealedKong: true,
  rounds: 1,
  startingScore: 500,
  faan: Object.fromEntries(FAAN_TABLE.map((e) => [e.id, e.faan])) as Record<FaanId, number>,
};

/** Fill in anything missing (rules saved by an older build) from the defaults. */
export function normalizeHkRules(rules: Partial<HkRules> | undefined): HkRules {
  return { ...DEFAULT_HK_RULES, ...rules, faan: { ...DEFAULT_HK_RULES.faan, ...rules?.faan } };
}

/** Table points for a faan count (before the 半銃 / 全銃 split). */
export function tablePoints(faan: number, rules: HkRules): number {
  const f = Math.max(0, Math.min(faan, rules.maxFaan));
  if (rules.spicy === 'full' || f <= 4) return 2 ** f;
  const k = f - 4;
  return 16 * 2 ** Math.floor(k / 2) * (k % 2 === 1 ? 1.5 : 1);
}

// ------------------------------------------------------------ evaluation

interface Group {
  type: 'chi' | 'pong' | 'kong';
  kind: Kind;
  concealed: boolean;
}

function item(id: FaanId, rules: HkRules, times = 1): ScoreItem {
  const e = ENTRY.get(id)!;
  return { id, zh: e.zh, en: times > 1 ? `${e.en} ×${times}` : e.en, value: rules.faan[id] * times };
}

function finish(regular: ScoreItem[], limits: ScoreItem[], conditions: ScoreItem[], rules: HkRules): WinScore {
  let items: ScoreItem[];
  let limit = false;
  if (limits.length > 0) {
    // Limit hands score only their own value plus the winning-condition faan.
    const top = limits.reduce((a, b) => (b.value > a.value ? b : a));
    items = [top, ...conditions];
    limit = true;
  } else {
    items = [...regular, ...conditions];
  }
  items = items.filter((i) => i.value !== 0);
  const raw = items.reduce((s, i) => s + i.value, 0);
  return { value: Math.min(raw, rules.maxFaan), raw, limit: limit || raw >= rules.maxFaan, items };
}

function bonusItems(input: WinInput, rules: HkRules): ScoreItem[] {
  const out: ScoreItem[] = [];
  if (input.bonus.length === 0) return [item('noFlowers', rules)];
  for (const start of [BONUS0, SEASON0]) {
    const held = input.bonus.filter((k) => k >= start && k < start + 4);
    if (held.length === 4) out.push(item('flowerSet', rules));
    else if (held.includes(start + input.seatWind)) out.push(item('seatFlower', rules));
  }
  return out;
}

function conditionItems(input: WinInput, rules: HkRules, concealedByDefinition: boolean): ScoreItem[] {
  const out: ScoreItem[] = [];
  if (input.selfDraw) out.push(item('selfDraw', rules));
  if (!concealedByDefinition && input.melds.every((m) => m.concealed)) out.push(item('concealed', rules));
  if (input.robbingKong) out.push(item('robbingKong', rules));
  if (input.lastTile) out.push(item('lastTile', rules));
  if (input.kongReplacement >= 2) out.push(item('doubleKongWin', rules));
  else if (input.kongReplacement === 1) out.push(item('kongWin', rules));
  return out;
}

function situationalLimits(input: WinInput, rules: HkRules): ScoreItem[] {
  const out: ScoreItem[] = [];
  if (input.heavenly) out.push(item('heavenly', rules));
  if (input.earthly) out.push(item('earthly', rules));
  return out;
}

/** Suits (0–2) and whether honors appear among `kinds`. */
function palette(kinds: Iterable<Kind>): { suits: Set<number>; honors: boolean } {
  const suits = new Set<number>();
  let honors = false;
  for (const k of kinds) {
    if (isSuit(k)) suits.add(suitOf(k));
    else if (isHonor(k)) honors = true;
  }
  return { suits, honors };
}

function purityItems(kinds: Iterable<Kind>, rules: HkRules): { regular: ScoreItem[]; limits: ScoreItem[] } {
  const { suits, honors } = palette(kinds);
  if (suits.size === 0) return { regular: [], limits: [item('allHonors', rules)] };
  if (suits.size === 1) return { regular: [item(honors ? 'mixedOneSuit' : 'allOneSuit', rules)], limits: [] };
  return { regular: [], limits: [] };
}

function isNineGates(counts: readonly number[]): boolean {
  for (let s = 0; s < 3; s++) {
    const c = counts.slice(s * 9, s * 9 + 9);
    if (c.reduce((a, b) => a + b, 0) !== 14) continue;
    const need = [3, 1, 1, 1, 1, 1, 1, 1, 3];
    return need.every((n, i) => c[i]! >= n);
  }
  return false;
}

function scoreStandard(input: WinInput, d: Decomposition, openSet: number | null, rules: HkRules): WinScore {
  const groups: Group[] = [
    ...input.melds.map((m) => ({ type: m.type, kind: m.kind, concealed: m.concealed })),
    ...d.sets.map((s, i) => ({ type: s.type, kind: s.kind, concealed: i !== openSet })),
  ];
  const pongs = groups.filter((g) => g.type !== 'chi');
  const tileKinds: Kind[] = [d.pair];
  for (const g of groups) {
    if (g.type === 'chi') tileKinds.push(g.kind, g.kind + 1, g.kind + 2);
    else tileKinds.push(g.kind);
  }
  const regular: ScoreItem[] = [];
  const limits: ScoreItem[] = situationalLimits(input, rules);

  if (groups.every((g) => g.type === 'chi')) regular.push(item('commonHand', rules));
  if (pongs.length === groups.length) regular.push(item('allTriplets', rules));

  const purity = purityItems(tileKinds, rules);
  regular.push(...purity.regular);
  limits.push(...purity.limits);

  if (pongs.length === groups.length && isOrphan(d.pair) && pongs.every((g) => isOrphan(g.kind))) {
    const { suits, honors } = palette(tileKinds);
    if (!honors) limits.push(item('orphans', rules));
    else if (suits.size > 0) regular.push(item('mixedOrphans', rules));
  }

  // Dragons: small / great three dragons replace the individual dragon pongs.
  const dragonPongs = pongs.filter((g) => isDragon(g.kind)).length;
  if (dragonPongs === 3) regular.push(item('greatDragons', rules));
  else if (dragonPongs === 2 && isDragon(d.pair)) regular.push(item('smallDragons', rules));
  else if (dragonPongs > 0) regular.push(item('dragonPong', rules, dragonPongs));

  const windPongs = pongs.filter((g) => isWind(g.kind));
  if (windPongs.length === 4) limits.push(item('greatWinds', rules));
  else if (windPongs.length === 3 && isWind(d.pair)) regular.push(item('smallWinds', rules));
  if (windPongs.some((g) => g.kind === windKind(input.seatWind))) regular.push(item('seatWind', rules));
  if (windPongs.some((g) => g.kind === windKind(input.prevailing))) regular.push(item('prevailingWind', rules));

  const fourConcealed = groups.length === 4 && pongs.length === 4 && pongs.every((g) => g.concealed);
  if (fourConcealed) limits.push(item('fourConcealedPongs', rules));
  if (groups.filter((g) => g.type === 'kong').length === 4) limits.push(item('allKongs', rules));
  const nineGates = input.melds.length === 0 && isNineGates(countKinds(input.concealed));
  if (nineGates) limits.push(item('nineGates', rules));

  regular.push(...bonusItems(input, rules));
  // 坎坎糊 and 九子連環 are concealed by definition: no extra 門前清 on top.
  const byDefinition = limits.some((l) => l.id === 'fourConcealedPongs' || l.id === 'nineGates');
  return finish(regular, limits, conditionItems(input, rules, byDefinition), rules);
}

function scoreSevenPairs(input: WinInput, rules: HkRules): WinScore {
  const regular: ScoreItem[] = [item('sevenPairs', rules)];
  const limits = situationalLimits(input, rules);
  const purity = purityItems(input.concealed, rules);
  regular.push(...purity.regular, ...bonusItems(input, rules));
  limits.push(...purity.limits);
  return finish(regular, limits, conditionItems(input, rules, true), rules);
}

function better(a: WinScore, b: WinScore): boolean {
  return b.value > a.value || (b.value === a.value && b.raw > a.raw);
}

/** Score a winning hand, or null when the tiles don't form one. */
export function evaluateHk(input: WinInput, rules: HkRules): WinScore | null {
  if (input.flowerWin) {
    const it = item(input.flowerWin === 'eight' ? 'eightFlowers' : 'sevenRobOne', rules);
    return { value: Math.min(it.value, rules.maxFaan), raw: it.value, limit: input.flowerWin === 'eight', items: [it] };
  }
  const counts = countKinds(input.concealed);
  const sets = 4 - input.melds.length;
  let best: WinScore | null = null;
  const consider = (s: WinScore) => {
    if (!best || better(best, s)) best = s;
  };

  if (input.melds.length === 0 && isThirteenOrphans(counts)) {
    consider(finish([], [item('thirteenOrphans', rules), ...situationalLimits(input, rules)], conditionItems(input, rules, true), rules));
  }
  if (rules.sevenPairs && input.melds.length === 0 && isSevenPairs(counts)) consider(scoreSevenPairs(input, rules));

  for (const d of decompose(counts, sets)) {
    // On a discard win the set the discard completes counts as exposed (it
    // matters for 坎坎糊). Try every set the winning tile could sit in.
    const homes: (number | null)[] = [];
    if (!input.selfDraw) {
      d.sets.forEach((s, i) => {
        const inSet = s.type === 'pong' ? s.kind === input.winTile : input.winTile >= s.kind && input.winTile <= s.kind + 2;
        if (inSet) homes.push(i);
      });
      if (d.pair === input.winTile) homes.push(null);
    } else {
      homes.push(null);
    }
    for (const h of homes) consider(scoreStandard(input, d, h, rules));
  }
  return best;
}

// ------------------------------------------------------------ settlement

const isSpecialFlowerWin = (score: WinScore) => score.items.some((i) => i.id === 'eightFlowers' || i.id === 'sevenRobOne');

function meldSuit(m: { kind: Kind }): number | null {
  return isSuit(m.kind) ? suitOf(m.kind) : null;
}

/** 包: who (if anyone) pays for everyone. Only under 半銃. */
export function liabilityFor(input: WinInput, score: WinScore, rules: HkRules): { seat: number; rule: string } | null {
  if (!rules.liability || rules.payment !== 'halfGun' || input.flowerWin) return null;
  const has = (id: FaanId) => score.items.some((i) => i.id === id);
  const byOrder = [...input.melds].sort((a, b) => a.order - b.order);

  // Feeding the last dragon / wind pong of 大三元 / 大四喜.
  for (const [id, test, n, rule] of [
    ['greatDragons', isDragon, 3, '包大三元'],
    ['greatWinds', isWind, 4, '包大四喜'],
  ] as const) {
    if (!has(id)) continue;
    const ms = byOrder.filter((m) => test(m.kind) && m.type !== 'chi');
    const last = ms[ms.length - 1];
    if (ms.length === n && last && last.from !== null && last.from !== input.seat) return { seat: last.from, rule };
  }

  const oneSuitMelds = (count: number) => {
    if (input.melds.length < count) return false;
    const suits = new Set(input.melds.map(meldSuit));
    return suits.size === 1 && !suits.has(null);
  };
  // 十二張包自摸: fed the fourth same-suit meld of an All One Suit hand that then self-draws.
  if (input.selfDraw && has('allOneSuit') && input.melds.length === 4 && oneSuitMelds(4)) {
    const last = byOrder[3]!;
    if (last.from !== null && last.from !== input.seat) return { seat: last.from, rule: '十二張包自摸' };
  }
  if (!input.selfDraw && input.from !== null) {
    // 九張包: discarding into an All One Suit hand that already showed three melds of the suit.
    if (has('allOneSuit') && oneSuitMelds(3)) return { seat: input.from, rule: '九張包' };
    // 五子包生: discarding a never-seen tile with five or fewer tiles left in the wall.
    if (input.wallLeft <= 5 && input.discardUnseen) return { seat: input.from, rule: '五子包生' };
  }
  return null;
}

export function settleHk(input: WinInput, score: WinScore, rules: HkRules): Settlement {
  const T = tablePoints(score.value, rules);
  const deltas = [0, 0, 0, 0];
  const others = [0, 1, 2, 3].filter((s) => s !== input.seat);
  const liable = liabilityFor(input, score, rules);
  const pay = (seat: number, amount: number) => {
    deltas[seat]! -= amount;
    deltas[input.seat]! += amount;
  };
  if (input.selfDraw) {
    // Self-draw: everyone pays half the table value (the winner takes 1.5×).
    if (liable) pay(liable.seat, T * 1.5);
    else for (const s of others) pay(s, T / 2);
  } else {
    const payer = input.from!;
    if (liable) pay(liable.seat, T);
    else if (rules.payment === 'fullGun') pay(payer, T);
    else {
      pay(payer, T / 2);
      for (const s of others) if (s !== payer) pay(s, T / 4);
    }
  }
  return { deltas, points: T, liable: liable?.seat ?? null, liabilityRule: liable?.rule ?? null };
}

// ------------------------------------------------------------ the variant

export const HK_VARIANT: Variant<HkRules> = {
  id: 'hk',
  name: 'Hong Kong Old Style',
  zh: '香港舊章',
  region: 'Hong Kong / Cantonese',
  status: 'playable',
  blurb: 'Classic Cantonese mahjong: 13-tile hands, flowers, a 3-faan minimum and doubling payouts.',
  highlights: [
    '144 tiles with flowers and seasons',
    'Chow only from the player on your left; Win > Pong / Kong > Chow',
    '3-faan minimum, limit hands at 10 faan (十番爆棚)',
    'Half-spicy payouts, discarder pays half (半銃) with 包 liability',
    'Robbing the kong, kong-replacement wins, 八仙過海',
  ],
  tiles: { bonus: 8, jokers: 0 },
  handSize: 13,
  reserve: 0,
  unit: { zh: '番', en: 'faan' },
  defaultRules: DEFAULT_HK_RULES,
  claims: { chi: 'left', robKong: true },
  shape: (r) => ({ sevenPairs: r.sevenPairs, thirteenOrphans: true }),
  evaluate: evaluateHk,
  canWin: (score, r) => isSpecialFlowerWin(score) || score.value >= r.minFaan,
  settle: settleHk,
  dealerStays: (winners, dealer, r) => (winners.length === 0 ? r.dealerStaysOnDraw : winners.includes(dealer)),
  rounds: (r) => r.rounds,
  multiWin: (r) => r.multiWin,
  flowerWins: (r) => r.flowerHands,
  robConcealedKong: (r) => r.robConcealedKong,
  startingScore: (r) => r.startingScore,
};
