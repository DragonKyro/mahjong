// Engine mechanics the new variants switch on: riichi (sticks, tsumogiri,
// furiten, kuikae, abortive draws, noten payments, dora), the Taiwanese deal,
// and American play (the Charleston, joker exchange, card-checked calls).
import { describe, expect, it } from 'vitest';
import {
  applyAction,
  charlestonAsk,
  claimOptions,
  createMatch,
  createRiggedMatch,
  isFuriten,
  pendingSeats,
  turnOptions,
  type MatchConfig,
  type MatchState,
} from './engine';
import { JOKER, kindOf, parseKinds, type Kind } from './tiles';
import { defaultRulesFor, type VariantId } from './variants';
import { FORMS } from './variants/american';

const config = (variant: VariantId, seed = 1): MatchConfig => ({
  variant,
  rules: defaultRulesFor(variant),
  seed,
  seats: [0, 1, 2, 3].map((i) => ({ name: `P${i}`, ai: false })),
});

function front(hands: string[], dealer: number, dealerDraw: string, draws = '', handSize = 13): Kind[] {
  const h = hands.map(parseKinds);
  h.forEach((x, i) => expect(x, `seat ${i} hand`).toHaveLength(handSize));
  const order = [0, 1, 2, 3].map((i) => (dealer + i) % 4);
  const out: Kind[] = [];
  let dealt = 0;
  while (dealt < handSize) {
    const n = Math.min(4, handSize - dealt);
    for (const s of order) out.push(...h[s]!.slice(dealt, dealt + n));
    dealt += n;
  }
  return [...out, ...parseKinds(dealerDraw), ...parseKinds(draws)];
}

const passAll = (s: MatchState) => {
  let x = s;
  while (x.hand.phase === 'claim') x = applyAction(x, { type: 'claim', seat: pendingSeats(x)[0]!, claim: { type: 'pass' } });
  return x;
};
const discardKind = (s: MatchState, seat: number, t: string) =>
  applyAction(s, { type: 'discard', seat, tile: s.hand.players[seat]!.hand.find((id) => kindOf(id) === parseKinds(t)[0])! });

// Hands that never call each other's discards (and aren't ready).
const QUIET = ['1z 1z 1z 2z 2z 2z 3z 3z 4z 4z 5z 6z 7z', '159m 159p 159s 2468m', '2468p 2468s 7z 9m 9p 9s 1s'];

describe('riichi', () => {
  // Ready on 1s / 4s once the drawn 7z goes.
  const ready = '123m 456m 789p 23s 55p';
  const start = () => createRiggedMatch(config('riichi'), { dealer: 0, front: front([ready, ...QUIET], 0, '7z', '3p 3p 3p 9s 9s') });

  it('a riichi discard pays its stick once it goes through, then only the drawn tile may go', () => {
    let s = start();
    const opts = turnOptions(s, 0);
    expect(opts.riichi.map(kindOf)).toContain(parseKinds('7z')[0]);
    s = applyAction(s, { type: 'discard', seat: 0, tile: s.hand.players[0]!.hand.find((t) => kindOf(t) === parseKinds('7z')[0])!, riichi: true });
    s = passAll(s);
    expect(s.scores[0]).toBe(24000);
    expect(s.sticks).toBe(1);
    expect(s.hand.riichi[0]).toMatchObject({ double: true, paid: true });
    for (let seat = 1; seat <= 3; seat++) s = passAll(applyAction(s, { type: 'discard', seat, tile: s.hand.drawn! }));
    expect(s.hand.turn).toBe(0);
    expect(turnOptions(s, 0).allowed).toEqual([s.hand.drawn]);
  });

  it('furiten: a wait in your own discards blocks ron', () => {
    const s = start();
    expect(isFuriten(s, 0)).toBe(false);
    const x: MatchState = JSON.parse(JSON.stringify(s));
    // Without the 7z the hand waits on 1s / 4s; put a 4s among its discards.
    x.hand.players[0]!.hand = x.hand.players[0]!.hand.filter((t) => kindOf(t) !== parseKinds('7z')[0]);
    expect(isFuriten(x, 0)).toBe(false);
    x.hand.players[0]!.gone.push(parseKinds('4s')[0]! * 4 + 3);
    expect(isFuriten(x, 0)).toBe(true);
  });

  it('dora indicator, and a kong reveals another', () => {
    const s = start();
    expect(s.hand.dora).toBe(1);
    const kongHand = '3333m 456m 789p 23s 5p';
    let k = createRiggedMatch(config('riichi'), { dealer: 0, front: front([kongHand, ...QUIET], 0, '5p') });
    k = applyAction(k, { type: 'kong', seat: 0, kind: parseKinds('3m')[0]! });
    expect(k.hand.dora).toBe(2);
    expect(k.hand.kans[0]).toBe(1);
  });

  it('九種九牌 aborts the hand; the dealer keeps the deal with a counter', () => {
    const orphans = '19m 19p 19s 1234z 2m 3m 4m';
    let s = createRiggedMatch(config('riichi'), { dealer: 0, front: front([orphans, ...QUIET.map((h) => h)], 0, '5m') });
    expect(turnOptions(s, 0).abort).toBe(true);
    s = applyAction(s, { type: 'abort', seat: 0 });
    expect(s.hand.result).toMatchObject({ end: 'abortive' });
    for (let i = 0; i < 4; i++) s = applyAction(s, { type: 'ready', seat: i });
    expect(s.dealer).toBe(0);
    expect(s.honba).toBe(1);
  });

  it('kuikae: no discarding what you just ponged', () => {
    const hands = ['5p 2m 3m 4m 6m 7m 8m 2s 3s 4s 6s 7s 8s', '55p 1z 1z 2z 2z 3z 3z 4z 4z 5z 5z 6z', ...QUIET.slice(1)];
    let s = createRiggedMatch(config('riichi'), { dealer: 0, front: front(hands, 0, '9m') });
    s = discardKind(s, 0, '5p');
    s = applyAction(s, { type: 'claim', seat: 1, claim: { type: 'pong' } });
    expect(s.hand.turn).toBe(1);
    expect(s.hand.forbidden).toEqual([parseKinds('5p')[0]]);
  });

  it('an exhaustive draw pays the ready players (noten payments)', () => {
    // Nagashi off: this artificially short hand's discards are all terminals / honors.
    let s = createRiggedMatch(
      { ...config('riichi'), rules: { ...defaultRulesFor('riichi'), nagashi: false } },
      { dealer: 0, front: front([ready, ...QUIET], 0, '7z', '3p 3p 3p 9s 9s') },
    );
    s = applyAction(s, { type: 'discard', seat: 0, tile: s.hand.players[0]!.hand.find((t) => kindOf(t) === parseKinds('7z')[0])! });
    s = passAll(s);
    // Run the wall down to its last live tile.
    s.hand.head = s.hand.tail - 14 - 1;
    while (s.hand.phase !== 'end') {
      if (s.hand.phase === 'claim') s = passAll(s);
      else {
        const p = s.hand.players[s.hand.turn]!;
        // Keep seat 0's ready hand: throw what was drawn.
        s = applyAction(s, { type: 'discard', seat: s.hand.turn, tile: s.hand.drawn ?? p.hand[0]! });
      }
    }
    expect(s.hand.result!.end).toBe('exhausted');
    expect(s.hand.result!.tenpai![0]).toBe(true);
    expect(s.hand.result!.deltas[0]).toBe(3000);
    expect(s.hand.result!.dealerStays).toBe(true);
  });
});

describe('taiwan', () => {
  it('deals sixteen tiles, seventeen to the dealer', () => {
    const s = createMatch(config('taiwan', 4));
    s.hand.players.forEach((p, i) => expect(p.hand.length).toBe(i === s.dealer ? 17 : 16));
  });
});

describe('american', () => {
  it('runs the Charleston: three passes, a vote, a courtesy pass, then the dealer discards', () => {
    let s = createMatch(config('american', 7));
    expect(s.hand.phase).toBe('charleston');
    s.hand.players.forEach((p, i) => expect(p.hand.length).toBe(i === s.dealer ? 14 : 13));
    const pass = (x: MatchState) => {
      for (let seat = 0; seat < 4; seat++) {
        const ask = charlestonAsk(x, seat)!;
        if (ask.kind === 'vote') x = applyAction(x, { type: 'vote', seat, yes: false });
        else x = applyAction(x, { type: 'pass', seat, tiles: x.hand.players[seat]!.hand.filter((t) => kindOf(t) !== JOKER).slice(0, ask.min) });
      }
      return x;
    };
    const before = s.hand.players[0]!.hand.slice(0, 3);
    s = pass(s);
    expect(s.hand.players[1]!.hand).toEqual(expect.arrayContaining(before)); // passed right
    s = pass(pass(s));
    expect(s.hand.charleston!.stage).toBe(3);
    s = pass(s); // everyone votes no → courtesy
    expect(s.hand.charleston!.stage).toBe(7);
    s = pass(s); // nobody passes anything
    expect(s.hand.phase).toBe('act');
    expect(s.hand.turn).toBe(s.dealer);
  });

  it('jokers are never passed', () => {
    const s = createMatch(config('american', 9));
    const seat = [0, 1, 2, 3].find((i) => s.hand.players[i]!.hand.some((t) => kindOf(t) === JOKER));
    if (seat === undefined) return;
    const joker = s.hand.players[seat]!.hand.find((t) => kindOf(t) === JOKER)!;
    const others = s.hand.players[seat]!.hand.filter((t) => t !== joker).slice(0, 2);
    expect(() => applyAction(s, { type: 'pass', seat, tiles: [joker, ...others] })).toThrow();
  });

  it('a natural tile buys back an exposed joker', () => {
    let s = createMatch({ ...config('american', 3), rules: { ...defaultRulesFor('american'), secondCharleston: false, courtesyPass: false } });
    for (let stage = 0; stage < 3; stage++)
      for (let seat = 0; seat < 4; seat++) s = applyAction(s, { type: 'pass', seat, tiles: s.hand.players[seat]!.hand.filter((t) => kindOf(t) !== JOKER).slice(0, 3) });
    const me = s.dealer;
    const other = (me + 1) % 4;
    // Plant an exposure of 1m 1m joker on the other seat and a natural 1m in the dealer's hand.
    const x: MatchState = JSON.parse(JSON.stringify(s));
    x.hand.players[other]!.melds.push({ type: 'set', tiles: [0, 1, 144], kind: 0, concealed: false, from: me, claimed: 1, order: 0 });
    x.hand.players[me]!.hand = [2, ...x.hand.players[me]!.hand.filter((t) => ![0, 1, 2, 144].includes(t))];
    for (const p of x.hand.players) p.hand = p.hand.filter((t) => t !== 144 && (p === x.hand.players[me] || ![0, 1, 2].includes(t)));
    const swap = turnOptions(x, me).swaps[0]!;
    expect(swap).toMatchObject({ tile: 2, target: { seat: other, order: 0 } });
    const y = applyAction(x, { type: 'swap', seat: me, tile: 2, target: swap.target });
    expect(y.hand.players[me]!.hand).toContain(144);
    expect(y.hand.players[other]!.melds[0]!.tiles).toContain(2);
  });

  it('calls are checked against the card; Mah Jongg on a discard pays double from the discarder', () => {
    let s = createMatch({ ...config('american', 5), rules: { ...defaultRulesFor('american'), secondCharleston: false, courtesyPass: false } });
    for (let stage = 0; stage < 3; stage++)
      for (let seat = 0; seat < 4; seat++) s = applyAction(s, { type: 'pass', seat, tiles: s.hand.players[seat]!.hand.filter((t) => kindOf(t) !== JOKER).slice(0, 3) });
    const dealer = s.dealer;
    const winner = (dealer + 2) % 4;
    // Give the winner wd-1 (NNNN EEE WWW SSSS) minus one S, and the dealer that S.
    const form = FORMS.find((f) => f.hand.id === 'wd-1')!;
    const x: MatchState = JSON.parse(JSON.stringify(s));
    const winds = form.groups.flatMap((g) => new Array(g.n).fill(g.kind) as number[]);
    // All 16 wind tiles: 4 of each.
    const ids = (k: number) => [k * 4, k * 4 + 1, k * 4 + 2, k * 4 + 3];
    const need = new Map<number, number[]>();
    for (const k of new Set(winds)) need.set(k, ids(k));
    const winnerHand: number[] = [];
    for (const k of winds) winnerHand.push(need.get(k)!.shift()!);
    const sTile = winnerHand.pop()!; // the last S
    for (const p of x.hand.players) p.hand = p.hand.filter((t) => !(t < 136 && kindOf(t) >= 27 && kindOf(t) <= 30));
    x.hand.players[winner]!.hand = winnerHand;
    x.hand.players[dealer]!.hand = [sTile, ...x.hand.players[dealer]!.hand.slice(0, 13)];
    const y = applyAction(x, { type: 'discard', seat: dealer, tile: sTile });
    expect(claimOptions(y, winner)).toContainEqual({ type: 'win' });
    let z = y;
    while (z.hand.phase === 'claim') {
      const seat = pendingSeats(z)[0]!;
      z = applyAction(z, { type: 'claim', seat, claim: seat === winner ? { type: 'win' } : { type: 'pass' } });
    }
    const r = z.hand.result!;
    expect(r.wins[0]!.seat).toBe(winner);
    const v = r.wins[0]!.score.value; // 25, doubled for jokerless
    expect(v).toBe(50);
    expect(r.deltas[dealer]).toBe(-2 * v);
    expect(r.deltas[winner]).toBe(4 * v);
  });
});
