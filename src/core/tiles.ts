// Tiles as plain numbers, so match state stays JSON-serializable (the online
// action log replays it on every device).
//
// A *kind* is what a tile shows:
//    0–8   萬 characters 1–9   (notation "1m".."9m")
//    9–17  筒 circles 1–9      ("1p".."9p")
//   18–26  索 bamboo 1–9       ("1s".."9s")
//   27–30  東 南 西 北 winds   ("1z".."4z")
//   31–33  白 發 中 dragons    ("5z" "6z" "7z", tenhou order)
//   34–37  梅 蘭 菊 竹 flowers ("1f".."4f")
//   38–41  春 夏 秋 冬 seasons ("5f".."8f")
//   42     joker (American)    ("0j")
//
// A tile *id* names one physical tile; its kind follows from the id, so no
// lookup table travels with the state:
//     0–135  the 34 playing kinds × 4 copies   (kind = id >> 2)
//   136–143  the 8 bonus tiles                  (kind = 34 + id − 136)
//   144–151  8 jokers                           (kind = 42)
// A variant picks which ids are in its wall (see TileSetSpec).

export type Kind = number;
export type TileId = number;

/** Kinds that form hands (suits + honors). Count vectors are this long. */
export const PLAY_KINDS = 34;
export const WIND0 = 27;
export const DRAGON0 = 31;
export const BONUS0 = 34;
export const SEASON0 = 38;
export const JOKER = 42;

export const WHITE = 31;
export const GREEN = 32;
export const RED = 33;

export const kindOf = (id: TileId): Kind => (id < 136 ? id >> 2 : id < 144 ? BONUS0 + id - 136 : JOKER);

export const isSuit = (k: Kind) => k >= 0 && k < 27;
export const suitOf = (k: Kind) => Math.floor(k / 9); // 0 m, 1 p, 2 s
export const rankOf = (k: Kind) => (k % 9) + 1;
export const isHonor = (k: Kind) => k >= WIND0 && k < BONUS0;
export const isWind = (k: Kind) => k >= WIND0 && k < DRAGON0;
export const isDragon = (k: Kind) => k >= DRAGON0 && k < BONUS0;
export const isBonus = (k: Kind) => k >= BONUS0 && k < JOKER;
export const isTerminal = (k: Kind) => isSuit(k) && (k % 9 === 0 || k % 9 === 8);
export const isOrphan = (k: Kind) => isTerminal(k) || isHonor(k);
/** Wind kind for a seat/prevailing wind index (0 = East). */
export const windKind = (w: number) => WIND0 + w;
/** For a bonus kind: which seat it belongs to (0 = East … 3 = North). */
export const bonusSeat = (k: Kind) => (k - BONUS0) % 4;
export const isFlower = (k: Kind) => k >= BONUS0 && k < SEASON0;
export const isSeason = (k: Kind) => k >= SEASON0 && k < JOKER;

/** The 13 terminal and honor kinds of 十三么. */
export const ORPHANS: readonly Kind[] = [0, 8, 9, 17, 18, 26, 27, 28, 29, 30, 31, 32, 33];

// ---------------------------------------------------------------- tile sets

export interface TileSetSpec {
  /** Bonus tiles in the wall: 0 (Riichi), 8 (HK, Taiwan, American). */
  bonus: 0 | 8;
  /** Jokers in the wall (American: 8). */
  jokers: number;
  /** Red-five copies (Riichi aka-dora); cosmetic + scoring, the kind stays 5m/5p/5s. */
  redFives?: number;
}

/** Every tile id in a wall built from `spec`, in id order. */
export function tileIds(spec: TileSetSpec): TileId[] {
  const ids: TileId[] = [];
  for (let id = 0; id < 136; id++) ids.push(id);
  for (let i = 0; i < spec.bonus; i++) ids.push(136 + i);
  for (let i = 0; i < spec.jokers; i++) ids.push(144 + i);
  return ids;
}

// ---------------------------------------------------------------- notation

const SUIT_LETTERS = 'mps';

/**
 * Parse compact notation into kinds: "123m 456p 789s 11z 5z" (digits then a
 * suit letter; z = honors 1–7 = 東南西北白發中, f = bonus 1–8, j = joker).
 * Whitespace is ignored. Used by tests and the training puzzles.
 */
export function parseKinds(text: string): Kind[] {
  const out: Kind[] = [];
  let digits: number[] = [];
  for (const ch of text.replace(/\s+/g, '')) {
    if (ch >= '0' && ch <= '9') {
      digits.push(Number(ch));
      continue;
    }
    const s = SUIT_LETTERS.indexOf(ch);
    for (const d of digits) {
      if (s >= 0) {
        if (d < 1 || d > 9) throw new Error(`bad rank ${d}${ch}`);
        out.push(s * 9 + d - 1);
      } else if (ch === 'z') {
        if (d < 1 || d > 7) throw new Error(`bad honor ${d}z`);
        out.push(WIND0 + d - 1);
      } else if (ch === 'f') {
        if (d < 1 || d > 8) throw new Error(`bad bonus ${d}f`);
        out.push(BONUS0 + d - 1);
      } else if (ch === 'j') {
        out.push(JOKER);
      } else {
        throw new Error(`bad tile letter "${ch}" in "${text}"`);
      }
    }
    digits = [];
  }
  if (digits.length > 0) throw new Error(`dangling digits in "${text}"`);
  return out;
}

/** Inverse of parseKinds (grouped by suit, sorted). */
export function formatKinds(kinds: readonly Kind[]): string {
  const sorted = [...kinds].sort((a, b) => a - b);
  let out = '';
  let group = '';
  let letter = '';
  const flush = () => {
    if (group) out += group + letter;
    group = '';
  };
  for (const k of sorted) {
    let l: string;
    let d: number;
    if (isSuit(k)) [l, d] = [SUIT_LETTERS[suitOf(k)]!, rankOf(k)];
    else if (isHonor(k)) [l, d] = ['z', k - WIND0 + 1];
    else if (isBonus(k)) [l, d] = ['f', k - BONUS0 + 1];
    else [l, d] = ['j', 0];
    if (l !== letter) {
      flush();
      letter = l;
    }
    group += d;
  }
  flush();
  return out;
}

/** Distinct tile ids for `kinds` (first unused copy of each), for building test positions. */
export function idsForKinds(kinds: readonly Kind[], used: Set<TileId> = new Set()): TileId[] {
  return kinds.map((k) => {
    const candidates =
      k < PLAY_KINDS ? [k * 4, k * 4 + 1, k * 4 + 2, k * 4 + 3] : k === JOKER ? [144, 145, 146, 147, 148, 149, 150, 151] : [136 + k - BONUS0];
    const id = candidates.find((c) => !used.has(c));
    if (id === undefined) throw new Error(`no copy of kind ${k} left`);
    used.add(id);
    return id;
  });
}

/** 34-slot count vector of the playing kinds in `kinds` (bonus/jokers ignored). */
export function countKinds(kinds: Iterable<Kind>): number[] {
  const c = new Array<number>(PLAY_KINDS).fill(0);
  for (const k of kinds) if (k < PLAY_KINDS) c[k]!++;
  return c;
}

// ---------------------------------------------------------------- names

const NUMERALS = ['一', '二', '三', '四', '五', '六', '七', '八', '九'];
const SUIT_ZH = ['萬', '筒', '索'];
const SUIT_EN = ['Characters', 'Circles', 'Bamboo'];
export const WIND_ZH = ['東', '南', '西', '北'];
export const WIND_EN = ['East', 'South', 'West', 'North'];
const DRAGON_ZH = ['白', '發', '中'];
const DRAGON_EN = ['White Dragon', 'Green Dragon', 'Red Dragon'];
export const BONUS_ZH = ['梅', '蘭', '菊', '竹', '春', '夏', '秋', '冬'];
const BONUS_EN = ['Plum', 'Orchid', 'Chrysanthemum', 'Bamboo', 'Spring', 'Summer', 'Autumn', 'Winter'];

export function kindNameZh(k: Kind): string {
  if (isSuit(k)) return NUMERALS[rankOf(k) - 1]! + SUIT_ZH[suitOf(k)]!;
  if (isWind(k)) return WIND_ZH[k - WIND0]!;
  if (isDragon(k)) return ['白板', '發財', '紅中'][k - DRAGON0]!;
  if (isBonus(k)) return BONUS_ZH[k - BONUS0]!;
  return '百搭';
}

export function kindName(k: Kind): string {
  if (isSuit(k)) return `${rankOf(k)} ${SUIT_EN[suitOf(k)]}`;
  if (isWind(k)) return `${WIND_EN[k - WIND0]} Wind`;
  if (isDragon(k)) return DRAGON_EN[k - DRAGON0]!;
  if (isBonus(k)) return `${BONUS_EN[k - BONUS0]} (${k < SEASON0 ? 'flower' : 'season'} ${bonusSeat(k) + 1})`;
  return 'Joker';
}

export { DRAGON_ZH };
