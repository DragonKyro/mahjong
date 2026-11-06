// Japanese Riichi mahjong (日本麻雀): 136 tiles with three red fives, a
// 14-tile dead wall with dora indicators, yaku required to win, han + fu
// scoring, riichi, furiten, honba and riichi sticks, noten payments and
// abortive draws. Rules follow the common modern ruleset (Tenhou / Mahjong
// Soul defaults): kuitan on, aka dora on, kazoe yakuman, double ron with
// triple ron abortive, 4 fu for a double-wind pair, nagashi mangan, bust ends
// the game. The mechanics of the turn loop (riichi, furiten, kuikae, dora
// indicators, abortive draws) live in the engine under features.riichi.

import type { MatchState } from '../engine';
import { decompose, isSevenPairs, isThirteenOrphans, shanten, waits, type Decomposition } from '../hand';
import { countKinds, isDragon, isHonor, isOrphan, isSuit, isTerminal, isWind, kindOf, suitOf, windKind, type Kind, type TileId } from '../tiles';
import type { DrawSettlement, ScoreItem, Settlement, Variant, WinInput, WinScore } from './index';

export interface RiichiRules {
  startingScore: number;
  /** 1 東風戦 (East round), 2 東南戦 (East + South). */
  rounds: 1 | 2;
  akaDora: boolean;
  /** Open tanyao. */
  kuitan: boolean;
  /** 13+ han counts as yakuman. */
  kazoe: boolean;
  /** 4 han 30 fu and 3 han 60 fu round up to mangan. */
  kiriage: boolean;
  multiRon: 'double' | 'all' | 'head';
  /** The game ends when someone drops below zero. */
  tobi: boolean;
  nagashi: boolean;
  /** Fu for a pair of the double wind (seat = round). */
  doubleWindFu: 2 | 4;
}

export const DEFAULT_RIICHI_RULES: RiichiRules = {
  startingScore: 25000,
  rounds: 1,
  akaDora: true,
  kuitan: true,
  kazoe: true,
  kiriage: false,
  multiRon: 'double',
  tobi: true,
  nagashi: true,
  doubleWindFu: 4,
};

export function normalizeRiichiRules(r: Partial<RiichiRules> | undefined): RiichiRules {
  return { ...DEFAULT_RIICHI_RULES, ...r };
}

/** Copy 0 of each five is red: 5m, 5p, 5s. */
export const RED_FIVES: readonly TileId[] = [16, 52, 88];
export const isRedFive = (id: TileId) => RED_FIVES.includes(id);

export interface YakuEntry {
  id: string;
  zh: string;
  en: string;
  /** Han closed / open (0 = not allowed open). Yakuman entries use 13. */
  closed: number;
  open: number;
  desc: string;
  yakuman?: boolean;
}

export const YAKU: readonly YakuEntry[] = [
  { id: 'riichi', zh: '立直', en: 'Riichi', closed: 1, open: 0, desc: 'Declared ready with a concealed hand.' },
  { id: 'doubleRiichi', zh: 'ダブル立直', en: 'Double riichi', closed: 2, open: 0, desc: 'Riichi on your first discard, nobody having called.' },
  { id: 'ippatsu', zh: '一発', en: 'Ippatsu', closed: 1, open: 0, desc: 'Won within one go-around of riichi, no calls in between.' },
  { id: 'tsumo', zh: '門前清自摸和', en: 'Menzen tsumo', closed: 1, open: 0, desc: 'Self-drawn with a concealed hand.' },
  { id: 'pinfu', zh: '平和', en: 'Pinfu', closed: 1, open: 0, desc: 'All chows, a non-value pair, a two-sided wait.' },
  { id: 'iipeikou', zh: '一盃口', en: 'Iipeikou', closed: 1, open: 0, desc: 'Two identical chows.' },
  { id: 'tanyao', zh: '断幺九', en: 'All simples', closed: 1, open: 1, desc: 'No terminals or honors.' },
  { id: 'yakuhai', zh: '役牌', en: 'Value pong', closed: 1, open: 1, desc: 'A pong of a dragon, your seat wind or the round wind (each).' },
  { id: 'haitei', zh: '海底摸月', en: 'Haitei', closed: 1, open: 1, desc: 'Self-drawn on the last tile.' },
  { id: 'houtei', zh: '河底撈魚', en: 'Houtei', closed: 1, open: 1, desc: 'Won on the last discard.' },
  { id: 'rinshan', zh: '嶺上開花', en: 'Rinshan', closed: 1, open: 1, desc: "Won on a kong's replacement tile." },
  { id: 'chankan', zh: '搶槓', en: 'Robbing a kong', closed: 1, open: 1, desc: 'Won on a tile added to a pong.' },
  { id: 'chiitoitsu', zh: '七対子', en: 'Seven pairs', closed: 2, open: 0, desc: 'Seven different pairs (25 fu).' },
  { id: 'sanshoku', zh: '三色同順', en: 'Mixed triple chow', closed: 2, open: 1, desc: 'The same chow in all three suits.' },
  { id: 'ittsu', zh: '一気通貫', en: 'Straight', closed: 2, open: 1, desc: '123, 456, 789 of one suit.' },
  { id: 'chanta', zh: '混全帯幺九', en: 'Outside hand', closed: 2, open: 1, desc: 'Every set and the pair have a terminal or honor.' },
  { id: 'toitoi', zh: '対々和', en: 'All pongs', closed: 2, open: 2, desc: 'Every set a pong or kong.' },
  { id: 'sanankou', zh: '三暗刻', en: 'Three concealed pongs', closed: 2, open: 2, desc: 'Three pongs made in hand.' },
  { id: 'sanshokuDoukou', zh: '三色同刻', en: 'Triple pong', closed: 2, open: 2, desc: 'The same pong in all three suits.' },
  { id: 'sankantsu', zh: '三槓子', en: 'Three kongs', closed: 2, open: 2, desc: 'Three kongs.' },
  { id: 'honroutou', zh: '混老頭', en: 'All terminals and honors', closed: 2, open: 2, desc: 'Only 1s, 9s and honors.' },
  { id: 'shousangen', zh: '小三元', en: 'Little three dragons', closed: 2, open: 2, desc: 'Two dragon pongs and a dragon pair.' },
  { id: 'honitsu', zh: '混一色', en: 'Half flush', closed: 3, open: 2, desc: 'One suit plus honors.' },
  { id: 'junchan', zh: '純全帯幺九', en: 'Terminals in every set', closed: 3, open: 2, desc: 'Every set and the pair have a 1 or 9; no honors.' },
  { id: 'ryanpeikou', zh: '二盃口', en: 'Twice two identical chows', closed: 3, open: 0, desc: 'Two pairs of identical chows.' },
  { id: 'chinitsu', zh: '清一色', en: 'Full flush', closed: 6, open: 5, desc: 'One suit only.' },
  { id: 'kokushi', zh: '国士無双', en: 'Thirteen orphans', closed: 13, open: 0, desc: 'One of each terminal and honor plus a pair.', yakuman: true },
  { id: 'suuankou', zh: '四暗刻', en: 'Four concealed pongs', closed: 13, open: 0, desc: 'Four pongs made in hand (a ron must complete the pair).', yakuman: true },
  { id: 'daisangen', zh: '大三元', en: 'Big three dragons', closed: 13, open: 13, desc: 'Pongs of all three dragons.', yakuman: true },
  { id: 'shousuushii', zh: '小四喜', en: 'Little four winds', closed: 13, open: 13, desc: 'Three wind pongs and a wind pair.', yakuman: true },
  { id: 'daisuushii', zh: '大四喜', en: 'Big four winds', closed: 13, open: 13, desc: 'Pongs of all four winds.', yakuman: true },
  { id: 'tsuuiisou', zh: '字一色', en: 'All honors', closed: 13, open: 13, desc: 'Only winds and dragons.', yakuman: true },
  { id: 'chinroutou', zh: '清老頭', en: 'All terminals', closed: 13, open: 13, desc: 'Only 1s and 9s.', yakuman: true },
  { id: 'ryuuiisou', zh: '緑一色', en: 'All green', closed: 13, open: 13, desc: 'Only 2 3 4 6 8 bamboo and 發.', yakuman: true },
  { id: 'chuuren', zh: '九蓮宝燈', en: 'Nine gates', closed: 13, open: 0, desc: '1112345678999 of one suit plus any tile of it.', yakuman: true },
  { id: 'suukantsu', zh: '四槓子', en: 'Four kongs', closed: 13, open: 13, desc: 'Four kongs.', yakuman: true },
  { id: 'tenhou', zh: '天和', en: 'Heavenly hand', closed: 13, open: 0, desc: 'The dealer wins on the deal.', yakuman: true },
  { id: 'chiihou', zh: '地和', en: 'Earthly hand', closed: 13, open: 0, desc: 'A non-dealer self-draws on the first draw, nobody having called.', yakuman: true },
];
const Y = new Map(YAKU.map((y) => [y.id, y]));

const DORA_ITEMS = { dora: ['ドラ', 'Dora'], ura: ['裏ドラ', 'Ura dora'], aka: ['赤ドラ', 'Red five'] } as const;

function yaku(id: string, open: boolean, times = 1): ScoreItem {
  const y = Y.get(id)!;
  const han = open ? y.open : y.closed;
  return { id, zh: y.zh, en: times > 1 ? `${y.en} ×${times}` : y.en, value: han * times };
}

const ceil100 = (n: number) => Math.ceil(n / 100) * 100;
const fmt = (n: number) => n.toLocaleString('en-US');

// ------------------------------------------------------------ hand reading

type WaitShape = 'ryanmen' | 'kanchan' | 'penchan' | 'shanpon' | 'tanki';

interface Group {
  type: 'chi' | 'pon' | 'kan';
  kind: Kind;
  /** Concealed for fu / sanankou: made in hand (and not completed by a ron). */
  concealed: boolean;
}

interface Reading {
  groups: Group[];
  pair: Kind;
  wait: WaitShape;
}

function readings(input: WinInput, d: Decomposition): Reading[] {
  const melds: Group[] = input.melds.map((m) => ({
    type: m.type === 'chi' ? 'chi' : m.type === 'kong' ? 'kan' : 'pon',
    kind: m.kind,
    concealed: m.concealed,
  }));
  const out: Reading[] = [];
  const base = d.sets.map((x) => ({ type: (x.type === 'chi' ? 'chi' : 'pon') as Group['type'], kind: x.kind, concealed: true }));
  const w = input.winTile;
  if (d.pair === w) out.push({ groups: [...melds, ...base], pair: d.pair, wait: 'tanki' });
  base.forEach((g, i) => {
    if (g.type === 'pon' && g.kind === w) {
      const groups = base.map((x, j) => (j === i ? { ...x, concealed: input.selfDraw } : x));
      out.push({ groups: [...melds, ...groups], pair: d.pair, wait: 'shanpon' });
    } else if (g.type === 'chi' && w >= g.kind && w <= g.kind + 2) {
      const p = w - g.kind;
      const r = g.kind % 9;
      const wait: WaitShape = p === 1 ? 'kanchan' : (p === 0 && r === 6) || (p === 2 && r === 0) ? 'penchan' : 'ryanmen';
      out.push({ groups: [...melds, ...base], pair: d.pair, wait });
    }
  });
  return out;
}

const groupTiles = (g: Group): Kind[] => (g.type === 'chi' ? [g.kind, g.kind + 1, g.kind + 2] : [g.kind]);
const hasOrphan = (g: Group) => groupTiles(g).some(isOrphan);
const isValueKind = (k: Kind, input: WinInput) => isDragon(k) || k === windKind(input.seatWind) || k === windKind(input.prevailing);

/** All tile ids in the hand, for dora / red fives. */
function allKinds(input: WinInput): Kind[] {
  return [...input.concealed, ...input.melds.flatMap((m) => m.tiles.map(kindOf))];
}

function doraItems(input: WinInput, rules: RiichiRules): ScoreItem[] {
  const all = allKinds(input);
  const out: ScoreItem[] = [];
  const count = (list: Kind[]) => list.reduce((n, d) => n + all.filter((k) => k === d).length, 0);
  const dora = count(input.dora);
  if (dora) out.push({ id: 'dora', zh: DORA_ITEMS.dora[0], en: `${DORA_ITEMS.dora[1]} ×${dora}`, value: dora });
  if (input.riichi) {
    const ura = count(input.uraDora);
    if (ura) out.push({ id: 'ura', zh: DORA_ITEMS.ura[0], en: `${DORA_ITEMS.ura[1]} ×${ura}`, value: ura });
  }
  if (rules.akaDora) {
    const ids = [...input.concealedIds, ...input.melds.flatMap((m) => m.tiles)];
    const aka = ids.filter(isRedFive).length;
    if (aka) out.push({ id: 'aka', zh: DORA_ITEMS.aka[0], en: `${DORA_ITEMS.aka[1]} ×${aka}`, value: aka });
  }
  return out;
}

function situational(input: WinInput, open: boolean): ScoreItem[] {
  const out: ScoreItem[] = [];
  if (input.riichi === 2) out.push(yaku('doubleRiichi', false));
  else if (input.riichi === 1) out.push(yaku('riichi', false));
  if (input.riichi && input.ippatsu) out.push(yaku('ippatsu', false));
  if (input.selfDraw && !open) out.push(yaku('tsumo', false));
  if (input.lastTile && input.selfDraw && input.kongReplacement === 0) out.push(yaku('haitei', open));
  if (input.lastTile && !input.selfDraw) out.push(yaku('houtei', open));
  if (input.selfDraw && input.kongReplacement > 0) out.push(yaku('rinshan', open));
  if (input.robbingKong) out.push(yaku('chankan', open));
  return out;
}

function situationalYakuman(input: WinInput): ScoreItem[] {
  if (!input.firstDraw) return [];
  return [yaku(input.seat === input.dealer ? 'tenhou' : 'chiihou', false)];
}

interface Scored {
  items: ScoreItem[];
  han: number;
  yakuHan: number;
  fu: number;
  yakuman: number;
}

function scoreReading(input: WinInput, r: Reading, rules: RiichiRules): Scored {
  const open = input.melds.some((m) => !m.concealed);
  const items: ScoreItem[] = [];
  const tiles = [r.pair, ...r.groups.flatMap(groupTiles)];
  const chis = r.groups.filter((g) => g.type === 'chi');
  const pons = r.groups.filter((g) => g.type !== 'chi');
  const suits = new Set(tiles.filter(isSuit).map(suitOf));
  const honors = tiles.some(isHonor);

  // Yakuman first.
  const ym: ScoreItem[] = [...situationalYakuman(input)];
  const concealedPons = pons.filter((g) => g.concealed).length;
  if (concealedPons === 4) ym.push(yaku('suuankou', false));
  const dragonPons = pons.filter((g) => isDragon(g.kind)).length;
  if (dragonPons === 3) ym.push(yaku('daisangen', open));
  const windPons = pons.filter((g) => isWind(g.kind)).length;
  if (windPons === 4) ym.push(yaku('daisuushii', open));
  else if (windPons === 3 && isWind(r.pair)) ym.push(yaku('shousuushii', open));
  if (tiles.every(isHonor)) ym.push(yaku('tsuuiisou', open));
  if (tiles.every(isTerminal)) ym.push(yaku('chinroutou', open));
  const greens = new Set([19, 20, 21, 23, 25, 32]);
  if (tiles.every((k) => greens.has(k))) ym.push(yaku('ryuuiisou', open));
  if (!open && input.melds.length === 0 && nineGates(countKinds(input.concealed))) ym.push(yaku('chuuren', false));
  if (r.groups.filter((g) => g.type === 'kan').length === 4) ym.push(yaku('suukantsu', open));
  if (ym.length > 0) return { items: ym, han: 13 * ym.length, yakuHan: 13 * ym.length, fu: 0, yakuman: ym.length };

  items.push(...situational(input, open));

  // Pinfu: concealed, four chows, a non-value pair, two-sided wait.
  const pinfu = !open && chis.length === 4 && !isValueKind(r.pair, input) && r.wait === 'ryanmen';
  if (pinfu) items.push(yaku('pinfu', false));

  if (!open) {
    const seen = new Map<Kind, number>();
    for (const g of chis) seen.set(g.kind, (seen.get(g.kind) ?? 0) + 1);
    const dupes = [...seen.values()].reduce((n, c) => n + Math.floor(c / 2), 0);
    if (dupes >= 2) items.push(yaku('ryanpeikou', false));
    else if (dupes === 1) items.push(yaku('iipeikou', false));
  }
  if (tiles.every((k) => isSuit(k) && !isTerminal(k)) && (!open || rules.kuitan)) items.push(yaku('tanyao', open));

  let value = 0;
  for (const g of pons) {
    if (isDragon(g.kind)) value++;
    if (g.kind === windKind(input.seatWind)) value++;
    if (g.kind === windKind(input.prevailing)) value++;
  }
  if (value) items.push(yaku('yakuhai', open, value));

  for (let rank = 0; rank < 7; rank++) {
    if ([0, 1, 2].every((s) => chis.some((g) => g.kind === s * 9 + rank))) {
      items.push(yaku('sanshoku', open));
      break;
    }
  }
  for (let s = 0; s < 3; s++) {
    if ([0, 3, 6].every((o) => chis.some((g) => g.kind === s * 9 + o))) {
      items.push(yaku('ittsu', open));
      break;
    }
  }
  const allOutside = r.groups.every(hasOrphan) && isOrphan(r.pair);
  if (allOutside && chis.length > 0) items.push(yaku(honors ? 'chanta' : 'junchan', open));
  if (pons.length === 4) items.push(yaku('toitoi', open));
  if (concealedPons === 3) items.push(yaku('sanankou', open));
  for (let rank = 0; rank < 9; rank++) {
    if ([0, 1, 2].every((s) => pons.some((g) => g.kind === s * 9 + rank))) {
      items.push(yaku('sanshokuDoukou', open));
      break;
    }
  }
  if (r.groups.filter((g) => g.type === 'kan').length === 3) items.push(yaku('sankantsu', open));
  if (tiles.every(isOrphan) && chis.length === 0) items.push(yaku('honroutou', open));
  if (dragonPons === 2 && isDragon(r.pair)) items.push(yaku('shousangen', open));
  if (suits.size === 1) items.push(yaku(honors ? 'honitsu' : 'chinitsu', open));

  const yakuHan = items.reduce((n, i) => n + i.value, 0);
  const dora = yakuHan > 0 ? doraItems(input, rules) : [];
  const han = yakuHan + dora.reduce((n, i) => n + i.value, 0);
  return { items: [...items, ...dora], han, yakuHan, fu: fuOf(input, r, open, pinfu, rules), yakuman: 0 };
}

function fuOf(input: WinInput, r: Reading, open: boolean, pinfu: boolean, rules: RiichiRules): number {
  if (pinfu) return input.selfDraw ? 20 : 30;
  let fu = 20;
  if (!open && !input.selfDraw) fu += 10;
  if (input.selfDraw) fu += 2;
  for (const g of r.groups) {
    if (g.type === 'chi') continue;
    let f = g.type === 'kan' ? 8 : 2;
    if (isOrphan(g.kind)) f *= 2;
    if (g.concealed) f *= 2;
    fu += f;
  }
  const seat = r.pair === windKind(input.seatWind);
  const round = r.pair === windKind(input.prevailing);
  if (isDragon(r.pair)) fu += 2;
  if (seat && round) fu += rules.doubleWindFu;
  else if (seat || round) fu += 2;
  if (r.wait === 'kanchan' || r.wait === 'penchan' || r.wait === 'tanki') fu += 2;
  if (open && fu === 20) fu = 30;
  return Math.ceil(fu / 10) * 10;
}

function nineGates(c: readonly number[]): boolean {
  for (let s = 0; s < 3; s++) {
    const x = c.slice(s * 9, s * 9 + 9);
    if (x.reduce((a, b) => a + b, 0) !== 14) continue;
    return [3, 1, 1, 1, 1, 1, 1, 1, 3].every((n, i) => x[i]! >= n);
  }
  return false;
}

// ------------------------------------------------------------ points

export function basePoints(han: number, fu: number, yakuman: number, rules: RiichiRules): { base: number; name: string } {
  if (yakuman > 0) return { base: 8000 * yakuman, name: yakuman > 1 ? `${yakuman}× yakuman` : 'Yakuman' };
  if (han >= 13 && rules.kazoe) return { base: 8000, name: 'Kazoe yakuman' };
  if (han >= 11) return { base: 6000, name: 'Sanbaiman' };
  if (han >= 8) return { base: 4000, name: 'Baiman' };
  if (han >= 6) return { base: 3000, name: 'Haneman' };
  if (han >= 5) return { base: 2000, name: 'Mangan' };
  if (rules.kiriage && ((han === 4 && fu === 30) || (han === 3 && fu === 60))) return { base: 2000, name: 'Mangan' };
  const base = fu * 2 ** (han + 2);
  return base >= 2000 ? { base: 2000, name: 'Mangan' } : { base, name: '' };
}

/** What each loser pays (before honba). */
export function payments(base: number, winnerIsDealer: boolean, selfDraw: boolean): { ron: number; dealer: number; other: number } {
  if (!selfDraw) return { ron: ceil100(base * (winnerIsDealer ? 6 : 4)), dealer: 0, other: 0 };
  if (winnerIsDealer) return { ron: 0, dealer: 0, other: ceil100(base * 2) };
  return { ron: 0, dealer: ceil100(base * 2), other: ceil100(base) };
}

function summarize(sc: Scored, input: WinInput, rules: RiichiRules): string {
  const { base, name } = basePoints(sc.han, sc.fu, sc.yakuman, rules);
  const pay = payments(base, input.seat === input.dealer, input.selfDraw);
  const amount = !input.selfDraw ? fmt(pay.ron) : input.seat === input.dealer ? `${fmt(pay.other)} all` : `${fmt(pay.other)}/${fmt(pay.dealer)}`;
  const head = sc.yakuman ? name : `${sc.han} han ${sc.fu} fu${name ? ` · ${name}` : ''}`;
  return `${head} · ${amount}`;
}

export function evaluateRiichi(input: WinInput, rules: RiichiRules): WinScore | null {
  const counts = countKinds(input.concealed);
  const sets = 4 - input.melds.length;
  const candidates: Scored[] = [];
  if (input.melds.length === 0 && isThirteenOrphans(counts)) {
    candidates.push({ items: [yaku('kokushi', false), ...situationalYakuman(input)], han: 13, yakuHan: 13, fu: 0, yakuman: 1 + situationalYakuman(input).length });
  }
  if (input.melds.length === 0 && isSevenPairs(counts)) {
    const kinds = input.concealed;
    const open = false;
    const ym = situationalYakuman(input);
    if (kinds.every(isHonor)) ym.push(yaku('tsuuiisou', false));
    if (ym.length > 0) candidates.push({ items: ym, han: 13 * ym.length, yakuHan: 13 * ym.length, fu: 0, yakuman: ym.length });
    else {
      const items: ScoreItem[] = [yaku('chiitoitsu', false), ...situational(input, open)];
      if (kinds.every((k) => isSuit(k) && !isTerminal(k))) items.push(yaku('tanyao', false));
      if (kinds.every(isOrphan)) items.push(yaku('honroutou', false));
      const suits = new Set(kinds.filter(isSuit).map(suitOf));
      if (suits.size === 1) items.push(yaku(kinds.some(isHonor) ? 'honitsu' : 'chinitsu', false));
      const yakuHan = items.reduce((n, i) => n + i.value, 0);
      const dora = doraItems(input, rules);
      candidates.push({ items: [...items, ...dora], han: yakuHan + dora.reduce((n, i) => n + i.value, 0), yakuHan, fu: 25, yakuman: 0 });
    }
  }
  for (const d of decompose(counts, sets)) for (const r of readings(input, d)) candidates.push(scoreReading(input, r, rules));
  if (candidates.length === 0) return null;
  // Best by points, then han.
  const value = (c: Scored) => basePoints(c.han, c.fu, c.yakuman, rules).base * 1000 + c.han;
  const best = candidates.reduce((a, b) => (value(b) > value(a) ? b : a));
  return {
    value: best.han,
    raw: best.yakuHan,
    limit: best.yakuman > 0 || best.han >= 5,
    items: best.items,
    summary: summarize(best, input, rules),
    han: best.han,
    fu: best.fu,
  };
}

/** Pao: who fed the last dragon / wind pong of a big-dragons / big-winds yakuman. */
function paoSeat(input: WinInput, score: WinScore): number | null {
  for (const [id, test, n] of [
    ['daisangen', isDragon, 3],
    ['daisuushii', isWind, 4],
  ] as const) {
    if (!score.items.some((i) => i.id === id)) continue;
    const melds = input.melds.filter((m) => m.type !== 'chi' && test(m.kind)).sort((a, b) => a.order - b.order);
    const last = melds[melds.length - 1];
    if (melds.length === n && last && last.from !== null && last.from !== input.seat) return last.from;
  }
  return null;
}

export function settleRiichi(input: WinInput, score: WinScore, rules: RiichiRules): Settlement {
  const yakuman = score.items.filter((i) => Y.get(i.id)?.yakuman).length;
  const { base } = basePoints(score.han ?? score.value, score.fu ?? 30, yakuman, rules);
  const dealerWins = input.seat === input.dealer;
  const pay = payments(base, dealerWins, input.selfDraw);
  const deltas = [0, 0, 0, 0];
  const give = (from: number, amount: number) => {
    deltas[from]! -= amount;
    deltas[input.seat]! += amount;
  };
  const pao = paoSeat(input, score);
  let total: number;
  if (input.selfDraw) {
    total = 0;
    for (let s = 0; s < 4; s++) {
      if (s === input.seat) continue;
      const amount = (s === input.dealer ? pay.dealer || pay.other : pay.other) + 100 * input.honba;
      total += amount;
      if (pao === null) give(s, amount);
    }
    if (pao !== null) give(pao, total);
  } else {
    total = pay.ron + 300 * input.honba;
    if (pao !== null && pao !== input.from) {
      give(pao, pay.ron / 2);
      give(input.from!, pay.ron / 2 + 300 * input.honba);
    } else give(input.from!, total);
  }
  deltas[input.seat]! += 1000 * input.sticks;
  return { deltas, points: total, liable: pao, liabilityRule: pao !== null ? '包 Pao' : null };
}

// ------------------------------------------------------------ draws and rotation

/** Exhaustive draw: noten payments (3000 split) or nagashi mangan. */
export function exhaustedRiichi(s: MatchState): DrawSettlement {
  const rules = s.config.rules as RiichiRules;
  const h = s.hand;
  const deltas = [0, 0, 0, 0];
  const notes: string[] = [];
  const tenpai = [0, 1, 2, 3].map((seat) => {
    if (h.riichi[seat]) return true;
    const p = h.players[seat]!;
    const c = countKinds(p.hand.map(kindOf));
    const sets = 4 - p.melds.length;
    if (shanten(c, sets, { sevenPairs: true, thirteenOrphans: true }) !== 0) return false;
    return waits(c, sets, { sevenPairs: true, thirteenOrphans: true }).length > 0;
  });
  const nagashi = rules.nagashi
    ? [0, 1, 2, 3].filter((seat) => {
        const p = h.players[seat]!;
        return p.gone.length > 0 && p.gone.length === p.discards.length && p.gone.every((t) => isOrphan(kindOf(t)));
      })
    : [];
  if (nagashi.length > 0) {
    for (const seat of nagashi) {
      const pay = payments(2000, seat === s.dealer, true);
      for (let o = 0; o < 4; o++) {
        if (o === seat) continue;
        const amount = o === s.dealer ? pay.dealer || pay.other : pay.other;
        deltas[o]! -= amount;
        deltas[seat]! += amount;
      }
      notes.push(`${s.config.seats[seat]!.name}: 流し満貫 nagashi mangan`);
    }
    return { deltas, tenpai, notes };
  }
  const ready = tenpai.filter(Boolean).length;
  if (ready > 0 && ready < 4) {
    const gain = 3000 / ready;
    const loss = 3000 / (4 - ready);
    tenpai.forEach((t, seat) => (deltas[seat] = t ? gain : -loss));
    notes.push('不聴罰符 noten payments');
  }
  return { deltas, tenpai, notes };
}

export const RIICHI_VARIANT: Variant<RiichiRules> = {
  id: 'riichi',
  name: 'Japanese Riichi',
  zh: '日本麻雀',
  region: 'Japan',
  status: 'playable',
  blurb: 'No flowers, red fives and dora; every win needs a yaku, and a concealed ready hand can declare riichi.',
  highlights: [
    '136 tiles with three red fives; a 14-tile dead wall with dora indicators',
    'At least one yaku to win; han and fu set the points',
    'Riichi, ippatsu, furiten, double ron',
    'Honba counters and noten payments on an exhaustive draw',
    'From 25,000 points over an East (or East–South) game',
  ],
  tiles: { bonus: 0, jokers: 0, redFives: 3 },
  handSize: 13,
  unit: { zh: '翻', en: 'han' },
  terms: { ron: 'ロン', tsumo: 'ツモ', pong: 'ポン', kong: 'カン', chi: 'チー', pass: 'パス', riichi: 'リーチ' },
  features: { bonus: 'none', chi: 'left', kongs: true, robKong: true, riichi: true, american: false },
  defaultRules: DEFAULT_RIICHI_RULES,
  normalizeRules: (r) => normalizeRiichiRules(r as Partial<RiichiRules> | undefined),
  reserve: () => 14,
  shape: () => ({ sevenPairs: true, thirteenOrphans: true }),
  evaluate: evaluateRiichi,
  canWin: (score) => score.raw >= 1,
  settle: settleRiichi,
  exhausted: exhaustedRiichi,
  afterHand: (s, result) => {
    const dealerWon = result.wins.some((w) => w.seat === s.dealer);
    if (result.end === 'abortive') return { dealerStays: true, honba: s.honba + 1 };
    if (result.end === 'exhausted') return { dealerStays: !!result.tenpai?.[s.dealer], honba: s.honba + 1 };
    return { dealerStays: dealerWon, honba: dealerWon ? s.honba + 1 : 0 };
  },
  matchOver: (s) => {
    const r = s.config.rules as RiichiRules;
    return s.prevailing >= r.rounds || (r.tobi && s.scores.some((x) => x < 0));
  },
  multiWin: (r) => r.multiRon,
  flowerWins: () => false,
  robConcealedKong: () => true,
  startingScore: (r) => r.startingScore,
  minimum: () => 1,
};
