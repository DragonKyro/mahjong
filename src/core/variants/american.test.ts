import { describe, expect, it } from 'vitest';
import { blankWinInput } from '../engine';
import { BONUS0, JOKER, idsForKinds, type Kind, type TileId } from '../tiles';
import { DEFAULT_AMERICAN_RULES, FLOWER, FORMS, HOUSE_CARD, distance, evaluateAmerican, holdingOf, matches, settleAmerican } from './american';

/** The tiles of a form, with `jokers` of its pung-or-larger tiles swapped for jokers. */
function tilesFor(formIndex: number, jokers = 0): TileId[] {
  const f = FORMS[formIndex]!;
  const kinds: Kind[] = [];
  let left = jokers;
  for (const g of f.groups) {
    for (let i = 0; i < g.n; i++) {
      if (g.n >= 3 && left > 0 && i < g.n - 1) {
        kinds.push(JOKER);
        left--;
      } else kinds.push(g.kind === FLOWER ? BONUS0 + (kinds.filter((x) => x >= BONUS0 && x < JOKER).length % 8) : g.kind);
    }
  }
  return idsForKinds(kinds);
}

describe('the house card', () => {
  it('every hand is 14 tiles and has at least one form', () => {
    for (const hand of HOUSE_CARD.hands) {
      const forms = FORMS.filter((f) => f.hand.id === hand.id);
      expect(forms.length, hand.id).toBeGreaterThan(0);
      for (const f of forms) expect(f.need.reduce((a, b) => a + b, 0), hand.id).toBe(14);
    }
  });

  it('a natural hand matches its form; jokers fill pungs but not pairs', () => {
    const i = FORMS.findIndex((f) => f.hand.id === '2468-1');
    const natural = holdingOf(tilesFor(i), []);
    expect(matches(FORMS[i]!, natural)).toBe(true);
    expect(matches(FORMS[i]!, holdingOf(tilesFor(i, 2), []))).toBe(true);
    // A joker standing in for a pair tile does not count.
    const f = FORMS[i]!;
    const pairKind = f.groups.find((g) => g.n === 2)!.kind;
    const tiles = tilesFor(i);
    const drop = tiles.findIndex((x) => Math.floor(x / 4) === pairKind);
    const bad = tiles.filter((_t, j) => j !== drop);
    expect(matches(f, holdingOf([...bad, 144], []))).toBe(false);
  });

  it('distance counts what is missing', () => {
    const i = FORMS.findIndex((f) => f.hand.id === 'wd-1');
    const tiles = tilesFor(i);
    expect(distance(FORMS[i]!, holdingOf(tiles.slice(0, 13), []))).toBe(1);
    expect(distance(FORMS[i]!, holdingOf(tiles.slice(0, 10), []))).toBe(4);
  });

  it('concealed hands refuse exposures', () => {
    const i = FORMS.findIndex((f) => f.hand.id === 'sp-2');
    const h = holdingOf(tilesFor(i), [{ tiles: idsForKinds([1, 1, 1]), kind: 1 }]);
    expect(distance(FORMS[i]!, h)).toBe(Infinity);
  });
});

describe('scoring', () => {
  const i = FORMS.findIndex((f) => f.hand.id === 'wd-1');
  const input = (ids: TileId[], selfDraw: boolean) =>
    blankWinInput({ seat: 0, concealed: ids.map((t) => (t >= 144 ? JOKER : t >= 136 ? BONUS0 + t - 136 : t >> 2)), concealedIds: ids, winTile: 27, melds: [], selfDraw, from: selfDraw ? null : 2 });
  it('values, jokerless doubling and payments', () => {
    const plain = evaluateAmerican(input(tilesFor(i), false), DEFAULT_AMERICAN_RULES)!;
    expect(plain.value).toBe(50); // 25 jokerless ×2
    const withJoker = evaluateAmerican(input(tilesFor(i, 1), false), DEFAULT_AMERICAN_RULES)!;
    expect(withJoker.value).toBe(25);
    expect(settleAmerican(input(tilesFor(i, 1), false), withJoker).deltas).toEqual([100, -25, -50, -25]);
    expect(settleAmerican(input(tilesFor(i, 1), true), withJoker).deltas).toEqual([150, -50, -50, -50]);
  });
  it('not a card hand: no win', () => {
    expect(evaluateAmerican(input(idsForKinds([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13]), false), DEFAULT_AMERICAN_RULES)).toBeNull();
  });
});
