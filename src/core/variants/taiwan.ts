// Taiwanese 16-tile mahjong (台灣十六張): 16-tile hands of five sets and a
// pair, flowers, and 台 (tai) paid on top of a base stake (底). The dealer
// (莊家) and dealer streaks (連莊拉莊) add tai to every payment between the
// dealer and another player. There's no minimum: a hand with no tai still
// wins the base. Every value is data in `TaiwanRules`.
//
// The table follows the common Taiwanese 16-tile scoring; house tables vary
// (天胡 / 地胡 / 人胡, 嚦咕嚦咕, the cap), which is why they're all editable.

import type { MatchState } from '../engine';
import { decompose, waits, type Decomposition } from '../hand';
import { BONUS0, SEASON0, countKinds, isDragon, isHonor, isSuit, isWind, suitOf, windKind, type Kind } from '../tiles';
import type { ScoreItem, Settlement, Variant, WinInput, WinScore } from './index';

export type TaiId =
  | 'dealer'
  | 'streak'
  | 'concealed'
  | 'selfDraw'
  | 'concealedSelfDraw'
  | 'seatFlower'
  | 'flowerSet'
  | 'dragonPong'
  | 'seatWind'
  | 'prevailingWind'
  | 'allChows'
  | 'allExposed'
  | 'singleWait'
  | 'robbingKong'
  | 'kongWin'
  | 'lastTileDraw'
  | 'lastTileDiscard'
  | 'threeConcealed'
  | 'fourConcealed'
  | 'fiveConcealed'
  | 'allPongs'
  | 'mixedOneSuit'
  | 'allOneSuit'
  | 'allHonors'
  | 'smallDragons'
  | 'greatDragons'
  | 'smallWinds'
  | 'greatWinds'
  | 'heavenly'
  | 'earthly'
  | 'human'
  | 'sevenRobOne'
  | 'eightFlowers'
  | 'liguLigu';

export interface TaiEntry {
  id: TaiId;
  zh: string;
  en: string;
  tai: number;
  group: 'dealer' | 'win' | 'bonus' | 'honor' | 'hand' | 'special';
  desc: string;
}

export const TAI_TABLE: readonly TaiEntry[] = [
  { id: 'dealer', zh: '莊家', en: 'Dealer', tai: 1, group: 'dealer', desc: 'Added to any payment the dealer makes or receives.' },
  { id: 'streak', zh: '連莊拉莊', en: 'Dealer streak', tai: 2, group: 'dealer', desc: 'Per hand the dealer has kept the deal (連一拉一 = 2 台), on the same payments.' },
  { id: 'concealed', zh: '門清', en: 'Concealed', tai: 1, group: 'win', desc: 'No melds claimed; won on a discard.' },
  { id: 'selfDraw', zh: '自摸', en: 'Self-drawn', tai: 1, group: 'win', desc: 'Drew the winning tile.' },
  { id: 'concealedSelfDraw', zh: '門清自摸', en: 'Concealed self-draw', tai: 3, group: 'win', desc: 'Concealed and self-drawn (instead of the two above).' },
  { id: 'singleWait', zh: '獨聽', en: 'Single wait', tai: 1, group: 'win', desc: 'Waiting on one tile only (邊張, 中洞, 單吊).' },
  { id: 'allExposed', zh: '全求人', en: 'All exposed', tai: 2, group: 'win', desc: 'Five melds claimed, the pair completed with a discard.' },
  { id: 'robbingKong', zh: '搶槓', en: 'Robbing the kong', tai: 1, group: 'win', desc: 'Won on a tile added to a pong.' },
  { id: 'kongWin', zh: '槓上開花', en: 'Win on a kong', tai: 1, group: 'win', desc: "Won on a kong's replacement tile." },
  { id: 'lastTileDraw', zh: '海底撈月', en: 'Last tile', tai: 1, group: 'win', desc: 'Self-drawn on the last tile.' },
  { id: 'lastTileDiscard', zh: '河底撈魚', en: 'Last discard', tai: 1, group: 'win', desc: 'Won on the discard after the last tile.' },
  { id: 'seatFlower', zh: '正花', en: 'Seat flower', tai: 1, group: 'bonus', desc: 'Each flower or season of your seat.' },
  { id: 'flowerSet', zh: '花槓', en: 'Flower set', tai: 2, group: 'bonus', desc: 'All four flowers, or all four seasons.' },
  { id: 'dragonPong', zh: '三元牌', en: 'Dragon pong', tai: 1, group: 'honor', desc: 'Each pong of 中, 發 or 白.' },
  { id: 'seatWind', zh: '門風', en: 'Seat wind', tai: 1, group: 'honor', desc: 'A pong of your seat wind.' },
  { id: 'prevailingWind', zh: '圈風', en: 'Round wind', tai: 1, group: 'honor', desc: "A pong of the round's wind." },
  { id: 'allChows', zh: '平胡', en: 'All chows', tai: 2, group: 'hand', desc: 'Five chows, no honors, no flowers, won on a discard with a two-sided wait.' },
  { id: 'threeConcealed', zh: '三暗刻', en: 'Three concealed pongs', tai: 2, group: 'hand', desc: 'Three pongs made in hand.' },
  { id: 'fourConcealed', zh: '四暗刻', en: 'Four concealed pongs', tai: 5, group: 'hand', desc: 'Four pongs made in hand.' },
  { id: 'fiveConcealed', zh: '五暗刻', en: 'Five concealed pongs', tai: 8, group: 'hand', desc: 'Five pongs made in hand.' },
  { id: 'allPongs', zh: '碰碰胡', en: 'All pongs', tai: 4, group: 'hand', desc: 'Every set a pong or kong.' },
  { id: 'mixedOneSuit', zh: '混一色', en: 'Mixed one suit', tai: 4, group: 'hand', desc: 'One suit plus honors.' },
  { id: 'allOneSuit', zh: '清一色', en: 'All one suit', tai: 8, group: 'hand', desc: 'One suit only.' },
  { id: 'allHonors', zh: '字一色', en: 'All honors', tai: 16, group: 'hand', desc: 'Winds and dragons only.' },
  { id: 'smallDragons', zh: '小三元', en: 'Small three dragons', tai: 4, group: 'hand', desc: 'Two dragon pongs and a dragon pair (dragon pongs included).' },
  { id: 'greatDragons', zh: '大三元', en: 'Great three dragons', tai: 8, group: 'hand', desc: 'Three dragon pongs (included).' },
  { id: 'smallWinds', zh: '小四喜', en: 'Small four winds', tai: 8, group: 'hand', desc: 'Three wind pongs and a wind pair (wind tai included).' },
  { id: 'greatWinds', zh: '大四喜', en: 'Great four winds', tai: 16, group: 'hand', desc: 'Four wind pongs (wind tai included).' },
  { id: 'liguLigu', zh: '嚦咕嚦咕', en: 'Seven pairs and a pong', tai: 8, group: 'hand', desc: 'Concealed: seven pairs plus one pong.' },
  { id: 'heavenly', zh: '天胡', en: 'Heavenly hand', tai: 16, group: 'special', desc: 'The dealer wins with the dealt tiles.' },
  { id: 'earthly', zh: '地胡', en: 'Earthly hand', tai: 16, group: 'special', desc: 'A non-dealer self-draws on the first draw, nobody having called.' },
  { id: 'human', zh: '人胡', en: 'Human hand', tai: 8, group: 'special', desc: 'Won on a discard before your first draw.' },
  { id: 'sevenRobOne', zh: '七搶一', en: 'Seven rob one', tai: 8, group: 'special', desc: 'Holding seven flowers, take the eighth from whoever drew it.' },
  { id: 'eightFlowers', zh: '八仙過海', en: 'Eight immortals', tai: 8, group: 'special', desc: 'All eight flowers.' },
];
const ENTRY = new Map(TAI_TABLE.map((e) => [e.id, e]));

export interface TaiwanRules {
  /** 底: what every payment starts from. */
  base: number;
  /** 台: paid per tai. */
  perTai: number;
  /** Minimum tai to win (0 = any complete hand). */
  minTai: number;
  /** Cap on hand tai (0 = none). Dealer tai come on top. */
  maxTai: number;
  /** 一炮多響. Off = 截胡, the next in turn wins. */
  multiWin: boolean;
  dealerStaysOnDraw: boolean;
  rounds: 1 | 2 | 4;
  /** Tiles left undrawn at the end of the wall. */
  reserve: number;
  flowerHands: boolean;
  liguLigu: boolean;
  startingScore: number;
  tai: Record<TaiId, number>;
}

export const DEFAULT_TAIWAN_RULES: TaiwanRules = {
  base: 30,
  perTai: 10,
  minTai: 0,
  maxTai: 0,
  multiWin: false,
  dealerStaysOnDraw: true,
  rounds: 1,
  reserve: 16,
  flowerHands: true,
  liguLigu: true,
  startingScore: 2000,
  tai: Object.fromEntries(TAI_TABLE.map((e) => [e.id, e.tai])) as Record<TaiId, number>,
};

export function normalizeTaiwanRules(r: Partial<TaiwanRules> | undefined): TaiwanRules {
  return { ...DEFAULT_TAIWAN_RULES, ...r, tai: { ...DEFAULT_TAIWAN_RULES.tai, ...r?.tai } };
}

function item(id: TaiId, rules: TaiwanRules, times = 1): ScoreItem {
  const e = ENTRY.get(id)!;
  return { id, zh: e.zh, en: times > 1 ? `${e.en} ×${times}` : e.en, value: rules.tai[id] * times };
}

/** Dealer tai for the current streak: 莊家 1 + 2 per hand kept. */
export function dealerTai(streak: number, rules: TaiwanRules): number {
  return rules.tai.dealer + rules.tai.streak * streak;
}

function dealerItems(input: WinInput, rules: TaiwanRules): ScoreItem[] {
  if (input.seat !== input.dealer) return [];
  const out = [item('dealer', rules)];
  if (input.streak > 0) out.push({ ...item('streak', rules, input.streak), en: `連${input.streak}拉${input.streak}` });
  return out;
}

function flowerItems(input: WinInput, rules: TaiwanRules): ScoreItem[] {
  const out: ScoreItem[] = [];
  for (const start of [BONUS0, SEASON0]) {
    const held = input.bonus.filter((k) => k >= start && k < start + 4);
    if (held.length === 4) out.push(item('flowerSet', rules));
    else if (held.includes(start + input.seatWind)) out.push(item('seatFlower', rules));
  }
  return out;
}

function conditionItems(input: WinInput, rules: TaiwanRules, concealedHand: boolean): ScoreItem[] {
  const out: ScoreItem[] = [];
  if (concealedHand && input.selfDraw) out.push(item('concealedSelfDraw', rules));
  else if (concealedHand) out.push(item('concealed', rules));
  else if (input.selfDraw) out.push(item('selfDraw', rules));
  if (input.robbingKong) out.push(item('robbingKong', rules));
  if (input.kongReplacement > 0) out.push(item('kongWin', rules));
  if (input.lastTile) out.push(item(input.selfDraw ? 'lastTileDraw' : 'lastTileDiscard', rules));
  return out;
}

function finish(items: ScoreItem[], rules: TaiwanRules, dealer: ScoreItem[]): WinScore {
  const kept = items.filter((i) => i.value !== 0);
  const raw = kept.reduce((s, i) => s + i.value, 0);
  const hand = rules.maxTai > 0 ? Math.min(raw, rules.maxTai) : raw;
  const extra = dealer.reduce((s, i) => s + i.value, 0);
  const value = hand + extra;
  return { value, raw: raw + extra, limit: rules.maxTai > 0 && raw >= rules.maxTai, items: [...kept, ...dealer], summary: `${value} 台` };
}

/** Does the hand before the winning tile wait on exactly one kind? */
function singleWait(input: WinInput): boolean {
  const before = [...input.concealed];
  before.splice(before.indexOf(input.winTile), 1);
  return waits(countKinds(before), 5 - input.melds.length).length === 1;
}

function scoreStandard(input: WinInput, d: Decomposition, openSet: number | null, rules: TaiwanRules, single: boolean): WinScore {
  const groups = [
    ...input.melds.map((m) => ({ type: m.type === 'set' ? ('pong' as const) : m.type, kind: m.kind, concealed: m.concealed })),
    ...d.sets.map((x, i) => ({ type: x.type as 'chi' | 'pong', kind: x.kind, concealed: i !== openSet })),
  ];
  const pongs = groups.filter((g) => g.type !== 'chi');
  const kindsUsed: Kind[] = [d.pair];
  for (const g of groups) kindsUsed.push(...(g.type === 'chi' ? [g.kind, g.kind + 1, g.kind + 2] : [g.kind]));
  const suits = new Set(kindsUsed.filter(isSuit).map(suitOf));
  const honors = kindsUsed.some(isHonor);
  const items: ScoreItem[] = [];

  const concealedHand = input.melds.every((m) => m.concealed);
  items.push(...conditionItems(input, rules, concealedHand));
  const allExposed = input.melds.length === 5 && input.melds.every((m) => !m.concealed) && !input.selfDraw;
  if (allExposed) items.push(item('allExposed', rules));
  else if (single) items.push(item('singleWait', rules));

  if (groups.every((g) => g.type === 'chi') && !honors && input.bonus.length === 0 && !input.selfDraw && !single) {
    items.push(item('allChows', rules));
  }
  if (pongs.length === groups.length) items.push(item('allPongs', rules));
  const concealedPongs = pongs.filter((g) => g.concealed).length;
  if (concealedPongs >= 5) items.push(item('fiveConcealed', rules));
  else if (concealedPongs === 4) items.push(item('fourConcealed', rules));
  else if (concealedPongs === 3) items.push(item('threeConcealed', rules));

  if (suits.size === 0) items.push(item('allHonors', rules));
  else if (suits.size === 1) items.push(item(honors ? 'mixedOneSuit' : 'allOneSuit', rules));

  const dragonPongs = pongs.filter((g) => isDragon(g.kind)).length;
  if (dragonPongs === 3) items.push(item('greatDragons', rules));
  else if (dragonPongs === 2 && isDragon(d.pair)) items.push(item('smallDragons', rules));
  else if (dragonPongs > 0) items.push(item('dragonPong', rules, dragonPongs));

  const windPongs = pongs.filter((g) => isWind(g.kind));
  if (windPongs.length === 4) items.push(item('greatWinds', rules));
  else if (windPongs.length === 3 && isWind(d.pair)) items.push(item('smallWinds', rules));
  else {
    if (windPongs.some((g) => g.kind === windKind(input.seatWind))) items.push(item('seatWind', rules));
    if (windPongs.some((g) => g.kind === windKind(input.prevailing))) items.push(item('prevailingWind', rules));
  }
  items.push(...flowerItems(input, rules));
  return finish(items, rules, dealerItems(input, rules));
}

function specialScore(input: WinInput, rules: TaiwanRules): WinScore | null {
  let id: TaiId | null = null;
  if (input.flowerWin === 'eight') id = 'eightFlowers';
  else if (input.flowerWin === 'sevenRobOne') id = 'sevenRobOne';
  else if (input.firstDraw && input.seat === input.dealer) id = 'heavenly';
  else if (input.firstDraw) id = 'earthly';
  else if (input.beforeFirstDraw) id = 'human';
  return id ? finish([item(id, rules)], rules, dealerItems(input, rules)) : null;
}

function isLiguLigu(counts: readonly number[]): boolean {
  for (let k = 0; k < counts.length; k++) {
    if (counts[k]! < 3) continue;
    const c = counts.slice();
    c[k]! -= 3;
    if (c.every((n) => n % 2 === 0) && c.reduce((a, b) => a + b, 0) === 14) return true;
  }
  return false;
}

export function evaluateTaiwan(input: WinInput, rules: TaiwanRules): WinScore | null {
  if (input.flowerWin) return specialScore(input, rules);
  const counts = countKinds(input.concealed);
  const sets = 5 - input.melds.length;
  let best: WinScore | null = null;
  const consider = (s: WinScore) => {
    if (!best || s.value > best.value) best = s;
  };
  const decomps = decompose(counts, sets);
  const liguLigu = rules.liguLigu && input.melds.length === 0 && isLiguLigu(counts);
  if (decomps.length === 0 && !liguLigu) return null;
  const special = specialScore(input, rules);
  if (special) return special;
  if (liguLigu) {
    const items = [item('liguLigu', rules), ...conditionItems(input, rules, true), ...flowerItems(input, rules)];
    consider(finish(items, rules, dealerItems(input, rules)));
  }
  const single = singleWait(input);
  for (const d of decomps) {
    const homes: (number | null)[] = [];
    if (!input.selfDraw) {
      d.sets.forEach((x, i) => {
        const inSet = x.type === 'pong' ? x.kind === input.winTile : input.winTile >= x.kind && input.winTile <= x.kind + 2;
        if (inSet) homes.push(i);
      });
      if (d.pair === input.winTile) homes.push(null);
    } else homes.push(null);
    for (const h of homes) consider(scoreStandard(input, d, h, rules, single));
  }
  return best;
}

export function settleTaiwan(input: WinInput, score: WinScore, rules: TaiwanRules): Settlement {
  const dTai = dealerTai(input.streak, rules);
  const winnerIsDealer = input.seat === input.dealer;
  const handTai = score.value - (winnerIsDealer ? dTai : 0);
  const deltas = [0, 0, 0, 0];
  const payers = input.selfDraw ? [0, 1, 2, 3].filter((s) => s !== input.seat) : [input.from!];
  for (const p of payers) {
    const tai = handTai + (winnerIsDealer || p === input.dealer ? dTai : 0);
    const amount = rules.base + rules.perTai * tai;
    deltas[p]! -= amount;
    deltas[input.seat]! += amount;
  }
  return { deltas, points: rules.base + rules.perTai * handTai, liable: null, liabilityRule: null };
}

export const TAIWAN_VARIANT: Variant<TaiwanRules> = {
  id: 'taiwan',
  name: 'Taiwanese 16-tile',
  zh: '台灣十六張',
  region: 'Taiwan',
  status: 'playable',
  blurb: 'Sixteen-tile hands of five sets and a pair, scored in tai on top of a base stake, with a big dealer bonus.',
  highlights: [
    '16-tile hands: five sets plus a pair',
    'No minimum — any complete hand wins the base (底), plus 台 per tai',
    'The dealer and dealer streaks (連莊拉莊) add tai to the dealer’s payments',
    'The last 16 tiles of the wall are never drawn',
    'Flowers score for their seat; seven robs one, all eight win outright',
  ],
  tiles: { bonus: 8, jokers: 0 },
  handSize: 16,
  unit: { zh: '台', en: 'tai' },
  terms: { ron: '胡', tsumo: '自摸', pong: '碰', kong: '槓', chi: '吃', pass: '過' },
  features: { bonus: 'setAside', chi: 'left', kongs: true, robKong: true, riichi: false, american: false },
  defaultRules: DEFAULT_TAIWAN_RULES,
  normalizeRules: (r) => normalizeTaiwanRules(r as Partial<TaiwanRules> | undefined),
  reserve: (r) => r.reserve,
  shape: () => ({ sevenPairs: false, thirteenOrphans: false }),
  evaluate: evaluateTaiwan,
  canWin: (score, r) => score.value >= r.minTai,
  settle: settleTaiwan,
  afterHand: (s, result) => ({
    dealerStays: result.wins.length === 0 ? (s.config.rules as TaiwanRules).dealerStaysOnDraw : result.wins.some((w) => w.seat === s.dealer),
    honba: 0,
  }),
  matchOver: (s: MatchState) => s.prevailing >= (s.config.rules as TaiwanRules).rounds,
  multiWin: (r) => (r.multiWin ? 'all' : 'head'),
  flowerWins: (r) => r.flowerHands,
  robConcealedKong: () => false,
  startingScore: (r) => r.startingScore,
  minimum: (r) => r.minTai,
};
