// American mah jongg: 152 tiles (8 flowers, 8 jokers), the Charleston, no
// chows, and winning hands taken from a hand card instead of "sets and a
// pair". Jokers stand in for any tile in a group of three or more alike, never
// in a pair or a single; a joker in an exposure can be bought back with the
// real tile. A discard can be called only to complete an exposure that fits a
// hand on the card, or for Mah Jongg.
//
// The official card is a yearly published product, so this app ships its own
// HOUSE_CARD in the same notation (and the matcher accepts any card in it):
//   digits in a suit — "2222a" a kong of 2s in suit a; suits a, b, c are
//   different suits; F flower; N E W S winds; R G 0 dragons (0 = white, also
//   used as zero); D the dragon of the token's suit (craks→red, bams→green,
//   dots→white). On a `run` hand digits are relative (1 = the lowest number).
// Within a token, repeated characters are one group: "1111a" a kong,
// "2468a" four singles, "11a 22a" two pairs.

import type { Claim, MatchState, Meld } from '../engine';
import { JOKER, isBonus, kindOf, type Kind, type TileId } from '../tiles';
import type { ScoreItem, Settlement, Variant, WinInput, WinScore } from './index';

export interface CardHand {
  id: string;
  cat: string;
  text: string;
  value: number;
  /** Concealed: no exposures (the last tile may still come off a discard). */
  concealed?: boolean;
  /** Digits are relative: the hand can be made from any starting number. */
  run?: boolean;
}

export interface Card {
  name: string;
  hands: CardHand[];
}

export const HOUSE_CARD: Card = {
  name: 'House Card 2026',
  hands: [
    { id: '2468-1', cat: '2468', text: 'FF 2222a 44b 66b 8888a', value: 25 },
    { id: '2468-2', cat: '2468', text: '222a 444a 666b 888b 22c', value: 25 },
    { id: '2468-3', cat: '2468', text: 'FFFF 2468a 222b 888b', value: 25 },
    { id: '2468-4', cat: '2468', text: 'FF 22a 44a 66a 88a DDDDa', value: 30 },
    { id: '2468-5', cat: '2468', text: '2468a 2468b 2468c FF', value: 50, concealed: true },
    { id: '13579-1', cat: '13579', text: '11a 333a 5555b 777b 99c', value: 25 },
    { id: '13579-2', cat: '13579', text: 'FFF 1111a 3333a 555a', value: 25 },
    { id: '13579-3', cat: '13579', text: '1111a 9999a 33b 55b 77b', value: 25 },
    { id: '13579-4', cat: '13579', text: 'FF 111a 999a 111b 999b', value: 25 },
    { id: '13579-5', cat: '13579', text: '13579a 13579b 99c FF', value: 50, concealed: true },
    { id: 'run-1', cat: 'Consecutive', text: '11a 222a 3333a 444a 55a', value: 25, run: true },
    { id: 'run-2', cat: 'Consecutive', text: '111a 2222b 333c FFFF', value: 25, run: true },
    { id: 'run-3', cat: 'Consecutive', text: '1111a 2222a 3333b FF', value: 25, run: true },
    { id: 'run-4', cat: 'Consecutive', text: '1234a 1234b 1111c FF', value: 30, run: true },
    { id: 'run-5', cat: 'Consecutive', text: '12345a 12345b 1111c', value: 35, run: true, concealed: true },
    { id: 'like-1', cat: 'Like numbers', text: 'FF 1111a 1111b 1111c', value: 25, run: true },
    { id: 'like-2', cat: 'Like numbers', text: '111a 111b 1111c NEWS', value: 30, run: true },
    { id: 'like-3', cat: 'Like numbers', text: '11a 11b 11c DDDDa FFFF', value: 30, run: true },
    { id: 'wd-1', cat: 'Winds & dragons', text: 'NNNN EEE WWW SSSS', value: 25 },
    { id: 'wd-2', cat: 'Winds & dragons', text: 'FF NNN EEE WWW SSS', value: 25 },
    { id: 'wd-3', cat: 'Winds & dragons', text: 'NN EE WW SS RRR GGG', value: 30 },
    { id: 'wd-4', cat: 'Winds & dragons', text: 'FFFF RRRR GGGG 00', value: 30 },
    { id: 'wd-5', cat: 'Winds & dragons', text: 'NEWS NEWS RR GG 00', value: 50, concealed: true },
    { id: '369-1', cat: '369', text: '333a 666a 9999b FFFF', value: 25 },
    { id: '369-2', cat: '369', text: '33a 66a 99a 3333b 6666b', value: 25 },
    { id: '369-3', cat: '369', text: '3333a 666b 9999c FFF', value: 25 },
    { id: '369-4', cat: '369', text: '369a 369b 3333c 6666c', value: 30 },
    { id: 'year-1', cat: '2026', text: 'FFFF 2026a 222b 222c', value: 25 },
    { id: 'year-2', cat: '2026', text: '2222a 000 2222b 666c', value: 30 },
    { id: 'quint-1', cat: 'Quints', text: 'FF 11111a 2222b 333c', value: 40, run: true },
    { id: 'quint-2', cat: 'Quints', text: 'NNNNN EEEE 11111a', value: 45, run: true },
    { id: 'sp-1', cat: 'Singles & pairs', text: 'NN EE WW SS 11a 11b 11c', value: 50, run: true, concealed: true },
    { id: 'sp-2', cat: 'Singles & pairs', text: 'FF 2468a 2468b 22c 44c', value: 50, concealed: true },
    { id: 'sp-3', cat: 'Singles & pairs', text: '11a 22a 33a 44a 55a 66a 77a', value: 50, run: true, concealed: true },
  ],
};

export interface AmericanRules {
  /** Hands in a match (each player deals hands / 4 times). */
  hands: number;
  /** A hand made without jokers scores double. */
  jokerless: boolean;
  secondCharleston: boolean;
  courtesyPass: boolean;
  startingScore: number;
}

export const DEFAULT_AMERICAN_RULES: AmericanRules = { hands: 4, jokerless: true, secondCharleston: true, courtesyPass: true, startingScore: 500 };

export function normalizeAmericanRules(r: Partial<AmericanRules> | undefined): AmericanRules {
  return { ...DEFAULT_AMERICAN_RULES, ...r };
}

// ------------------------------------------------------------ card forms

/** Matching kinds: 0–33 as usual, 34 = any flower. Jokers are counted apart. */
export const FLOWER = 34;
const SLOTS = 35;
/** The playing kind a tile counts as on the card (all flowers alike), or -1 for a joker. */
export const cardKind = (id: TileId): number => {
  const k = kindOf(id);
  if (k === JOKER) return -1;
  return isBonus(k) ? FLOWER : k;
};

export interface Group {
  kind: number;
  n: number;
}

export interface Form {
  hand: CardHand;
  groups: Group[];
  need: number[];
  /** Tiles of each kind in groups of 3+ (jokers may fill them). */
  jokerable: number[];
}

// Suits on the card: a = craks (m), b = bams (s), c = dots (p) before permuting.
const SUIT_DRAGON = [33, 31, 32]; // craks→red 中, dots→white 白, bams→green 發 (suit index 0 m, 1 p, 2 s)

function tokenGroups(token: string, suits: Record<string, number>, offset: number): Group[] | null {
  const m = /^([0-9NEWSFRGD]+)([abc]?)$/.exec(token);
  if (!m) throw new Error(`bad card token ${token}`);
  const chars = m[1]!;
  const suit = m[2] ? suits[m[2]]! : null;
  const out: Group[] = [];
  let i = 0;
  while (i < chars.length) {
    let j = i;
    while (j < chars.length && chars[j] === chars[i]) j++;
    const ch = chars[i]!;
    let kind: number;
    if (ch === 'F') kind = FLOWER;
    else if ('NEWS'.includes(ch)) kind = 27 + 'ESWN'.indexOf(ch);
    else if (ch === 'R') kind = 33;
    else if (ch === 'G') kind = 32;
    else if (ch === '0') kind = 31;
    else if (ch === 'D') {
      if (suit === null) throw new Error(`dragon without a suit in ${token}`);
      kind = SUIT_DRAGON[suit]!;
    } else {
      if (suit === null) throw new Error(`number without a suit in ${token}`);
      const d = Number(ch) + offset;
      if (d < 1 || d > 9) return null;
      kind = suit * 9 + d - 1;
    }
    out.push({ kind, n: j - i });
    i = j;
  }
  return out;
}

const PERMS = [
  [0, 1, 2],
  [0, 2, 1],
  [1, 0, 2],
  [1, 2, 0],
  [2, 0, 1],
  [2, 1, 0],
];

function expand(card: Card): Form[] {
  const out: Form[] = [];
  for (const hand of card.hands) {
    const tokens = hand.text.split(/\s+/);
    const letters = [...new Set(tokens.map((t) => /[abc]$/.exec(t)?.[0]).filter(Boolean))] as string[];
    const digits = tokens.flatMap((t) => [...t.replace(/[abc]$/, '')].filter((c) => /[1-9]/.test(c)).map(Number));
    const maxOffset = hand.run && digits.length ? 9 - Math.max(...digits) : 0;
    const seen = new Set<string>();
    for (const perm of PERMS) {
      const suits: Record<string, number> = {};
      letters.forEach((l, i) => (suits[l] = perm[i]!));
      for (let offset = 0; offset <= maxOffset; offset++) {
        const groups: Group[] = [];
        let ok = true;
        for (const t of tokens) {
          const g = tokenGroups(t, suits, offset);
          if (!g) ok = false;
          else groups.push(...g);
        }
        if (!ok) continue;
        const key = groups.map((g) => `${g.kind}x${g.n}`).sort().join(',');
        if (seen.has(key)) continue;
        seen.add(key);
        const need = new Array<number>(SLOTS).fill(0);
        const jokerable = new Array<number>(SLOTS).fill(0);
        for (const g of groups) {
          need[g.kind]! += g.n;
          if (g.n >= 3) jokerable[g.kind]! += g.n;
        }
        out.push({ hand, groups, need, jokerable });
      }
    }
  }
  return out;
}

export const FORMS: readonly Form[] = expand(HOUSE_CARD);

// ------------------------------------------------------------ matching

export interface Holding {
  /** Naturals by card kind (concealed + exposed). */
  counts: number[];
  jokers: number;
  /** Exposures as (card kind, size). */
  exposures: Group[];
}

function exposuresFit(form: Form, exposures: readonly Group[]): boolean {
  if (exposures.length === 0) return true;
  if (form.hand.concealed) return false;
  const free = form.groups.filter((g) => g.n >= 3).map((g) => ({ ...g, used: false }));
  for (const e of exposures) {
    const slot = free.find((g) => !g.used && g.kind === e.kind && g.n === e.n);
    if (!slot) return false;
    slot.used = true;
  }
  return true;
}

/** Tiles still missing for `form` (Infinity when the exposures rule it out). */
export function distance(form: Form, h: Holding): number {
  if (!exposuresFit(form, h.exposures)) return Infinity;
  let placed = 0;
  let slots = 0;
  for (let k = 0; k < SLOTS; k++) {
    const need = form.need[k]!;
    if (need === 0) continue;
    const n = Math.min(h.counts[k]!, need);
    placed += n;
    const nonJ = need - form.jokerable[k]!;
    slots += form.jokerable[k]! - Math.max(0, n - nonJ);
  }
  return 14 - placed - Math.min(h.jokers, slots);
}

export function matches(form: Form, h: Holding): boolean {
  if (!exposuresFit(form, h.exposures)) return false;
  let jokersNeeded = 0;
  for (let k = 0; k < SLOTS; k++) {
    const need = form.need[k]!;
    const n = h.counts[k]!;
    if (n > need || n < need - form.jokerable[k]!) return false;
    jokersNeeded += need - n;
  }
  return jokersNeeded === h.jokers;
}

export function holdingOf(concealed: readonly TileId[], melds: readonly { tiles: TileId[]; kind: Kind }[]): Holding {
  const counts = new Array<number>(SLOTS).fill(0);
  let jokers = 0;
  for (const t of [...concealed, ...melds.flatMap((m) => m.tiles)]) {
    const k = cardKind(t);
    if (k < 0) jokers++;
    else counts[k]!++;
  }
  const exposures = melds.map((m) => ({ kind: isBonus(m.kind) ? FLOWER : m.kind, n: m.tiles.length }));
  return { counts, jokers, exposures };
}

/** The card's hands ordered by how close `h` is to them. */
export function closest(h: Holding, limit = 5): { form: Form; distance: number }[] {
  const best = new Map<string, { form: Form; distance: number }>();
  for (const form of FORMS) {
    const d = distance(form, h);
    if (d === Infinity) continue;
    const prev = best.get(form.hand.id);
    if (!prev || d < prev.distance) best.set(form.hand.id, { form, distance: d });
  }
  return [...best.values()].sort((a, b) => a.distance - b.distance || b.form.hand.value - a.form.hand.value).slice(0, limit);
}

// ------------------------------------------------------------ claims and swaps (engine hooks)

function rulesOf(s: MatchState): AmericanRules {
  return s.config.rules as AmericanRules;
}

export function claimOptions(s: MatchState, seat: number, tile: TileId, _from: number): Claim[] {
  const p = s.hand.players[seat]!;
  const k = cardKind(tile);
  if (k < 0) return [];
  const out: Claim[] = [];
  const withTile = holdingOf([...p.hand, tile], p.melds);
  if (FORMS.some((f) => matches(f, withTile))) out.push({ type: 'win' });
  const live = s.hand.tail - s.hand.head > 0;
  if (!live) return out;
  const naturals = p.hand.filter((t) => cardKind(t) === k).length;
  const jokers = p.hand.filter((t) => kindOf(t) === JOKER).length;
  const current = holdingOf(p.hand, p.melds);
  for (let size = 3; size <= 6; size++) {
    const nat = Math.min(naturals, size - 1);
    const need = size - 1 - nat;
    if (need > jokers) continue;
    const exposures = [...current.exposures, { kind: k, n: size }];
    if (FORMS.some((f) => !f.hand.concealed && exposuresFit(f, exposures))) out.push({ type: 'expose', size, jokers: need });
  }
  return out;
}

export function applyExpose(s: MatchState, seat: number, claim: { size: number; jokers: number }, tile: TileId, from: number): void {
  const p = s.hand.players[seat]!;
  const k = cardKind(tile);
  const naturals = p.hand.filter((t) => cardKind(t) === k).slice(0, claim.size - 1 - claim.jokers);
  const jokers = p.hand.filter((t) => kindOf(t) === JOKER).slice(0, claim.jokers);
  const taken = new Set([...naturals, ...jokers]);
  p.hand = p.hand.filter((t) => !taken.has(t));
  const meld: Meld = { type: 'set', tiles: [...naturals, tile, ...jokers], kind: kindOf(tile), concealed: false, from, claimed: tile, order: p.melds.length };
  p.melds.push(meld);
}

export function jokerSwaps(s: MatchState, seat: number): { tile: TileId; target: { seat: number; order: number } }[] {
  const p = s.hand.players[seat]!;
  const out: { tile: TileId; target: { seat: number; order: number } }[] = [];
  s.hand.players.forEach((q, owner) => {
    for (const m of q.melds) {
      if (!m.tiles.some((t) => kindOf(t) === JOKER)) continue;
      const k = isBonus(m.kind) ? FLOWER : m.kind;
      const mine = p.hand.find((t) => cardKind(t) === k);
      if (mine !== undefined) out.push({ tile: mine, target: { seat: owner, order: m.order } });
    }
  });
  return out;
}

export function applySwap(s: MatchState, seat: number, tile: TileId, target: { seat: number; order: number }): void {
  const p = s.hand.players[seat]!;
  const m = s.hand.players[target.seat]!.melds.find((x) => x.order === target.order)!;
  const j = m.tiles.findIndex((t) => kindOf(t) === JOKER);
  const joker = m.tiles[j]!;
  m.tiles[j] = tile;
  p.hand.splice(p.hand.indexOf(tile), 1);
  p.hand.push(joker);
  p.hand.sort((a, b) => kindOf(a) - kindOf(b) || a - b);
}

// ------------------------------------------------------------ scoring

export function evaluateAmerican(input: WinInput, rules: AmericanRules): WinScore | null {
  const h = holdingOf(input.concealedIds, input.melds);
  if (h.counts.reduce((a, b) => a + b, 0) + h.jokers !== 14) return null;
  let best: Form | null = null;
  for (const f of FORMS) if (matches(f, h) && (!best || f.hand.value > best.hand.value)) best = f;
  if (!best) return null;
  const items: ScoreItem[] = [{ id: best.hand.id, zh: best.hand.cat, en: best.hand.text, value: best.hand.value }];
  let value = best.hand.value;
  const canUseJokers = best.groups.some((g) => g.n >= 3);
  if (rules.jokerless && h.jokers === 0 && canUseJokers) {
    items.push({ id: 'jokerless', zh: '無百搭', en: 'Jokerless ×2', value });
    value *= 2;
  }
  return { value, raw: value, limit: false, items, summary: `${best.hand.cat} · ${value} points` };
}

export function settleAmerican(input: WinInput, score: WinScore): Settlement {
  const deltas = [0, 0, 0, 0];
  const v = score.value;
  for (let s = 0; s < 4; s++) {
    if (s === input.seat) continue;
    const amount = input.selfDraw || s === input.from ? 2 * v : v;
    deltas[s]! -= amount;
    deltas[input.seat]! += amount;
  }
  return { deltas, points: v, liable: null, liabilityRule: null };
}

export const AMERICAN_VARIANT: Variant<AmericanRules> = {
  id: 'american',
  name: 'American',
  zh: '美式麻將',
  region: 'United States',
  status: 'playable',
  blurb: 'Jokers, the Charleston, and hands that must match a hand card of patterns instead of sets and a pair.',
  highlights: [
    '152 tiles: 8 flowers and 8 jokers',
    'The Charleston: tiles are passed between players before play',
    'Only hands on the card win; no chows',
    'Jokers stand in for tiles in groups of three or more — and can be bought back',
    'Discarder pays double, self-drawn pays double all round, jokerless doubles',
  ],
  tiles: { bonus: 8, jokers: 8 },
  handSize: 13,
  unit: { zh: '分', en: 'points' },
  terms: { ron: 'Mah Jongg', tsumo: 'Mah Jongg', pong: 'Pung', kong: 'Kong', chi: '', pass: 'Pass' },
  features: { bonus: 'tiles', chi: 'none', kongs: false, robKong: false, riichi: false, american: true },
  defaultRules: DEFAULT_AMERICAN_RULES,
  normalizeRules: (r) => normalizeAmericanRules(r as Partial<AmericanRules> | undefined),
  reserve: () => 0,
  shape: () => ({}),
  evaluate: evaluateAmerican,
  canWin: () => true,
  settle: (input, score) => settleAmerican(input, score),
  afterHand: () => ({ dealerStays: false, honba: 0 }),
  matchOver: (s) => s.handNo >= rulesOf(s).hands,
  multiWin: () => 'head',
  flowerWins: () => false,
  robConcealedKong: () => false,
  startingScore: (r) => r.startingScore,
  minimum: () => 0,
};

