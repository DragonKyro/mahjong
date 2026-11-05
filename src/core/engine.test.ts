import { describe, expect, it } from 'vitest';
import {
  applyAction,
  checksum,
  claimOptions,
  createMatch,
  createRiggedMatch,
  liveLeft,
  pendingSeats,
  turnOptions,
  type MatchConfig,
  type MatchState,
} from './engine';
import { kindOf, parseKinds, tileIds, type Kind } from './tiles';
import { DEFAULT_HK_RULES } from './variants/hk';

const config = (over: Partial<MatchConfig> = {}): MatchConfig => ({
  variant: 'hk',
  rules: DEFAULT_HK_RULES,
  seats: [0, 1, 2, 3].map((i) => ({ name: `P${i}`, ai: false })),
  seed: 42,
  ...over,
});

/** Wall front for a deal: 13-tile hands by seat, the dealer's 14th tile, then the draws in turn order. */
function front(hands: string[], dealer: number, dealerDraw: string, draws = ''): Kind[] {
  const h = hands.map(parseKinds);
  h.forEach((x, i) => expect(x, `seat ${i} hand`).toHaveLength(13));
  const order = [0, 1, 2, 3].map((i) => (dealer + i) % 4);
  const out: Kind[] = [];
  for (let r = 0; r < 3; r++) for (const s of order) out.push(...h[s]!.slice(r * 4, r * 4 + 4));
  for (const s of order) out.push(h[s]![12]!);
  return [...out, ...parseKinds(dealerDraw), ...parseKinds(draws)];
}

const kinds = (s: MatchState, seat: number) => s.hand.players[seat]!.hand.map(kindOf);
const k = (t: string) => parseKinds(t)[0]!;

function discard(s: MatchState, seat: number, tile: string): MatchState {
  const id = s.hand.players[seat]!.hand.find((t) => kindOf(t) === k(tile));
  if (id === undefined) throw new Error(`seat ${seat} has no ${tile}`);
  return applyAction(s, { type: 'discard', seat, tile: id });
}

const claim = (s: MatchState, seat: number, c: Parameters<typeof applyAction>[1] extends infer A ? (A extends { type: 'claim'; claim: infer C } ? C : never) : never) =>
  applyAction(s, { type: 'claim', seat, claim: c });

/** Everyone still deciding (except `keep`) passes. */
function passRest(s: MatchState, keep: number[] = []): MatchState {
  let x = s;
  while (x.hand.phase === 'claim') {
    const seat = pendingSeats(x).find((i) => !keep.includes(i));
    if (seat === undefined) break;
    x = claim(x, seat, { type: 'pass' });
  }
  return x;
}

function conserved(s: MatchState) {
  const h = s.hand;
  const all = [
    ...h.wall.slice(h.head, h.tail),
    ...h.players.flatMap((p) => [...p.hand, ...p.bonus, ...p.discards, ...p.melds.flatMap((m) => m.tiles)]),
  ].sort((a, b) => a - b);
  expect(all).toEqual(tileIds({ bonus: 8, jokers: 0 }));
}

describe('dealing', () => {
  it('deals 13 each, 14 to the dealer, bonus tiles set aside', () => {
    const s = createMatch(config({ seed: 7 }));
    s.hand.players.forEach((p, i) => {
      expect(p.hand.length).toBe(i === s.dealer ? 14 : 13);
      expect(p.hand.every((t) => kindOf(t) < 34)).toBe(true);
    });
    conserved(s);
    expect(pendingSeats(s)).toEqual([s.dealer]);
  });

  it('is deterministic per seed', () => {
    expect(checksum(createMatch(config({ seed: 9 })))).toBe(checksum(createMatch(config({ seed: 9 }))));
    expect(checksum(createMatch(config({ seed: 9 })))).not.toBe(checksum(createMatch(config({ seed: 10 }))));
  });
});

describe('claims', () => {
  // Seat 0 deals and throws 3m: seat 1 (its 下家) can chow, seat 2 can pong, seat 3 can chow nothing.
  const hands = [
    '3m 2p 5p 8p 2s 5s 8s 1z 2z 3z 4z 5z 6z',
    '12m 45m 3p 6p 9p 3s 6s 9s 1z 2z 3z',
    '33m 1p 4p 7p 1s 4s 7s 789m 6z 7z',
    '12m 6m 2p 3p 4p 2s 3s 4s 5z 5z 6z 7z',
  ];
  const start = () => discard(createRiggedMatch(config(), { dealer: 0, front: front(hands, 0, '7z', '9p 9s') }), 0, '3m');

  it('chow only from the left, pong beats chow', () => {
    const s = start();
    expect(claimOptions(s, 1).filter((c) => c.type === 'chi')).toHaveLength(3);
    expect(claimOptions(s, 2)).toEqual([{ type: 'pong' }]);
    expect(claimOptions(s, 3)).toEqual([]); // 12m but not seat 0's 下家
    const afterChi = claim(s, 1, { type: 'chi', low: k('1m') });
    expect(afterChi.hand.phase).toBe('claim'); // the pong could still beat it
    const afterPong = claim(afterChi, 2, { type: 'pong' });
    expect(afterPong.hand.turn).toBe(2);
    expect(afterPong.hand.players[2]!.melds[0]).toMatchObject({ type: 'pong', from: 0 });
    expect(afterPong.hand.players[0]!.discards).toHaveLength(0);
    expect(turnOptions(afterPong, 2).win).toBeNull(); // no self-draw after a claim
  });

  it('a chow goes through when the pong is passed', () => {
    let s = claim(start(), 2, { type: 'pass' });
    s = claim(s, 1, { type: 'chi', low: k('2m') });
    expect(s.hand.turn).toBe(1);
    expect(s.hand.players[1]!.melds[0]).toMatchObject({ type: 'chi', kind: k('2m') });
    expect(kinds(s, 1)).not.toContain(k('2m'));
    conserved(s);
  });

  it('resolves early once nobody pending can outrank the claim', () => {
    const s = claim(start(), 2, { type: 'pong' });
    expect(s.hand.phase).toBe('act'); // seat 1 could only chow, so it isn't waited for
    expect(s.hand.turn).toBe(2);
  });

  it('no claims: the next seat draws', () => {
    const s = passRest(start());
    expect(s.hand.turn).toBe(1);
    expect(s.hand.players[1]!.hand).toHaveLength(14);
  });
});

describe('wins', () => {
  it('head bump: the first seat after the discarder wins', () => {
    // Seats 1 and 3 both wait on 5p with 3+ faan (平糊 門前清 無花).
    const hands = [
      '5p 9p 2s 5s 8s 1z 2z 3z 4z 5z 6z 7z 9m',
      '123m 456m 789s 34p 66s',
      '1z 2z 3z 4z 5z 6z 7z 1z 2z 3z 4z 5z 6z',
      '234m 567m 123s 46p 99s',
    ];
    let s = createRiggedMatch(config(), { dealer: 0, front: front(hands, 0, '9s') });
    s = discard(s, 0, '5p');
    expect(claimOptions(s, 1)).toContainEqual({ type: 'win' });
    expect(claimOptions(s, 3)).toContainEqual({ type: 'win' });
    s = claim(s, 3, { type: 'win' });
    expect(s.hand.phase).toBe('claim'); // seat 1 is closer and could still win
    s = claim(s, 1, { type: 'win' });
    expect(s.hand.phase).toBe('end');
    expect(s.hand.result!.wins.map((w) => w.seat)).toEqual([1]);
    // Off the dealer's very first discard: 地糊, a limit hand (10 faan = 128, 半銃).
    expect(s.hand.result!.wins[0]!.score.items[0]!.id).toBe('earthly');
    expect(s.hand.result!.deltas).toEqual([-64, 128, -32, -32]);
    expect(s.scores.reduce((a, b) => a + b)).toBe(2000);
  });

  it('一炮多響 pays every winner', () => {
    const hands = [
      '5p 9p 2s 5s 8s 1z 2z 3z 4z 5z 6z 7z 9m',
      '123m 456m 789s 34p 66s',
      '1z 2z 3z 4z 5z 6z 7z 1z 2z 3z 4z 5z 6z',
      '234m 567m 123s 46p 99s',
    ];
    let s = createRiggedMatch(config({ rules: { ...DEFAULT_HK_RULES, multiWin: true } }), { dealer: 0, front: front(hands, 0, '9s') });
    s = discard(s, 0, '5p');
    s = claim(s, 1, { type: 'win' });
    s = claim(s, 3, { type: 'win' });
    expect(s.hand.result!.wins.map((w) => w.seat).sort()).toEqual([1, 3]);
  });

  it('heavenly hand', () => {
    const hands = ['123m 456m 789p 234s 5s', '1z1z1z2z 2z2z3z3z 3z4z4z4z 9m', '19m 19p 19s 5z5z5z 6z6z6z 7z', '2468m 2468p 2468s 7z'];
    const s = createRiggedMatch(config(), { dealer: 0, front: front(hands, 0, '5s') });
    const win = turnOptions(s, 0).win!;
    expect(win.items[0]!.id).toBe('heavenly');
    const done = applyAction(s, { type: 'win', seat: 0 });
    expect(done.hand.result!.wins[0]!.selfDraw).toBe(true);
  });

  it('kong replacement win (槓上開花) with a concealed kong', () => {
    const hands = ['1z1z1z1z 123m 456m 789p', '2z2z2z 3z3z3z 4z4z4z 5z5z5z 9m', '19m 19p 19s 6z6z6z 7z7z7z 1s', '2468m 2468p 2468s 7z'];
    let s = createRiggedMatch(config(), { dealer: 0, front: front(hands, 0, '5s'), back: parseKinds('5s') });
    expect(turnOptions(s, 0).kongs).toEqual([k('1z')]);
    s = applyAction(s, { type: 'kong', seat: 0, kind: k('1z') });
    expect(s.hand.drawKind).toBe('replacement');
    const win = turnOptions(s, 0).win!;
    const ids = win.items.map((i) => i.id);
    expect(ids).toEqual(expect.arrayContaining(['kongWin', 'selfDraw', 'concealed', 'seatWind', 'prevailingWind']));
    expect(ids).not.toContain('heavenly');
  });

  it('robbing an added kong (搶槓)', () => {
    // Seat 0 throws 5p, seat 1 pongs it; later seat 1 draws the last 5p and adds it — seat 2 robs.
    const hands = [
      '5p 9p 2s 5s 8s 1z 2z 3z 4z 5z 6z 7z 9m',
      '55p 1z 2z 3z 4z 5z 6z 7z 19m 19s',
      '123m 456m 789s 34p 66s',
      '2468m 2468p 2468s 7z',
    ];
    let s = createRiggedMatch(config(), { dealer: 0, front: front(hands, 0, '9s', '3s 1p 7m 5p') });
    s = discard(s, 0, '5p');
    s = claim(s, 2, { type: 'pass' }); // could win, but lets the pong through
    s = claim(s, 1, { type: 'pong' });
    s = passRest(discard(s, 1, '9m'));
    s = passRest(discard(s, 2, '3s'));
    s = passRest(discard(s, 3, '1p'));
    s = passRest(discard(s, 0, '7m'));
    expect(s.hand.turn).toBe(1);
    expect(turnOptions(s, 1).kongs).toContain(k('5p'));
    s = applyAction(s, { type: 'kong', seat: 1, kind: k('5p') });
    expect(s.hand.phase).toBe('claim');
    expect(s.hand.claim!.kind).toBe('robKong');
    s = claim(s, 2, { type: 'win' });
    const w = s.hand.result!.wins[0]!;
    expect(w).toMatchObject({ seat: 2, from: 1, robbingKong: true });
    expect(w.score.items.map((i) => i.id)).toContain('robbingKong');
    expect(s.hand.players[1]!.melds[0]!.type).toBe('pong'); // the kong is undone
  });
});

describe('bonus tiles', () => {
  it('八仙過海: all eight in the deal wins on the spot', () => {
    const hands = ['12345678f 123m 45m', '2z2z2z 3z3z3z 4z4z4z 5z5z5z 9m', '19m 19p 19s 6z6z6z 7z7z7z 1s', '2468m 2468p 2468s 7z'];
    const s = createRiggedMatch(config(), { dealer: 0, front: front(hands, 0, '6m'), back: parseKinds('12345678p') });
    expect(s.hand.phase).toBe('end');
    expect(s.hand.result!.wins[0]).toMatchObject({ seat: 0, flowerWin: 'eight', selfDraw: true });
  });

  it('七搶一: seven bonus tiles take the eighth from whoever has it', () => {
    const hands = ['1234567f 123m 456m', '8f 2z2z2z 3z3z3z 4z4z4z 9m 8p 8s', '19m 19p 19s 6z6z6z 7z7z7z 1s', '2468m 2468p 2468s 7z'];
    const s = createRiggedMatch(config(), { dealer: 0, front: front(hands, 0, '6m'), back: parseKinds('12345678p') });
    expect(s.hand.result!.wins[0]).toMatchObject({ seat: 0, from: 1, flowerWin: 'sevenRobOne' });
    expect(s.hand.result!.deltas[1]).toBeLessThan(0);
  });
});

describe('hand end and rotation', () => {
  it('an exhausted wall is a draw; the dealer keeps the deal', () => {
    let s = createMatch(config({ seed: 3 }));
    s.hand.head = s.hand.tail - 1; // one live tile left
    const dealer = s.dealer;
    // Discard the drawn tile around the table until the wall runs dry.
    while (s.hand.phase !== 'end') {
      if (s.hand.phase === 'claim') s = passRest(s);
      else s = applyAction(s, { type: 'discard', seat: s.hand.turn, tile: s.hand.players[s.hand.turn]!.hand[0]! });
    }
    expect(liveLeft(s)).toBe(0);
    expect(s.hand.result!.wins).toHaveLength(0);
    expect(s.hand.result!.dealerStays).toBe(true);
    for (let i = 0; i < 4; i++) s = applyAction(s, { type: 'ready', seat: i });
    expect(s.dealer).toBe(dealer);
    expect(s.streak).toBe(1);
    expect(s.handNo).toBe(2);
  });

  it('rejects illegal actions', () => {
    const s = createMatch(config({ seed: 5 }));
    const other = (s.dealer + 1) % 4;
    expect(() => applyAction(s, { type: 'discard', seat: other, tile: s.hand.players[other]!.hand[0]! })).toThrow();
    expect(() => applyAction(s, { type: 'win', seat: s.dealer })).toThrow();
    expect(() => applyAction(s, { type: 'ready', seat: 0 })).toThrow();
  });
});
