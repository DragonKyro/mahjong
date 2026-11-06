// The HK network's action space: a fixed set of 78 slots that covers every
// decision a Hong Kong Old Style player makes, a legality mask over them, and
// the mapping between slots and engine Actions.
//
// Tile ids of one kind are interchangeable in HK (no red fives; bonus tiles
// are set aside automatically), so discards are by kind. The one thing an id
// choice can still say is whether the tile thrown is the one just drawn (摸切,
// which the other players see), so that gets its own slot: "discard kind k"
// throws a copy from the hand, "tsumogiri" throws the drawn tile.
//
//   0–33   discard a concealed tile of kind k (not the drawn tile)
//   34     tsumogiri — discard the tile just drawn
//   35–68  kong kind k (concealed with four in hand, or added to a pong)
//   69     self-drawn win (自摸)
//   70     pass on a claim window
//   71     win on the discard / rob the kong (食糊 / 搶槓)
//   72     pong
//   73     kong the discard
//   74–76  chow, the discard being the low / middle / high tile of the run
//   77     ready (confirm the hand result)
//
// HK has no riichi, abort, Charleston or joker exchange, and flowers, 八仙過海
// and 七搶一 are automatic, so these are all of its actions.

import { claimOptions, turnOptions, type Action, type Claim, type MatchState } from '../engine';
import { kindOf, type Kind } from '../tiles';

/** Bump when slots are added, removed or reordered (trained policies are tied to it). */
export const ACTION_SPACE_VERSION = 1;

export const SLOT = {
  discard: 0,
  tsumogiri: 34,
  kong: 35,
  tsumo: 69,
  pass: 70,
  ron: 71,
  pong: 72,
  claimKong: 73,
  chi: 74,
  ready: 77,
} as const;

export const NUM_SLOTS = 78;

const KIND_NAMES = [
  ...[1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => `${n}m`),
  ...[1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => `${n}p`),
  ...[1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => `${n}s`),
  'E', 'S', 'W', 'N', 'Wh', 'Gr', 'Rd',
];

export const SLOT_NAMES: readonly string[] = [
  ...KIND_NAMES.map((k) => `discard ${k}`),
  'tsumogiri',
  ...KIND_NAMES.map((k) => `kong ${k}`),
  'tsumo',
  'pass',
  'ron',
  'pong',
  'claim kong',
  'chi low',
  'chi middle',
  'chi high',
  'ready',
];

/** The slot a claim maps to (`k` = the claimed tile's kind). */
function claimSlot(c: Claim, k: Kind): number {
  switch (c.type) {
    case 'pass':
      return SLOT.pass;
    case 'win':
      return SLOT.ron;
    case 'pong':
      return SLOT.pong;
    case 'kong':
      return SLOT.claimKong;
    case 'chi':
      return SLOT.chi + (k - c.low);
    default:
      throw new Error(`no HK slot for a ${c.type} claim`);
  }
}

/** 1 for every slot `seat` may play now, 0 elsewhere. All zero when the game isn't waiting on `seat`. */
export function legalMask(s: MatchState, seat: number): Uint8Array {
  const mask = new Uint8Array(NUM_SLOTS);
  const h = s.hand;
  if (s.over) return mask;
  if (h.phase === 'act' && h.turn === seat) {
    const o = turnOptions(s, seat);
    if (o.canDiscard) {
      for (const t of h.players[seat]!.hand) {
        if (o.allowed && !o.allowed.includes(t)) continue;
        mask[t === h.drawn ? SLOT.tsumogiri : SLOT.discard + kindOf(t)] = 1;
      }
    }
    for (const k of o.kongs) mask[SLOT.kong + k] = 1;
    if (o.win) mask[SLOT.tsumo] = 1;
  } else if (h.phase === 'claim' && h.claim) {
    const options = claimOptions(s, seat);
    if (options.length > 0) {
      mask[SLOT.pass] = 1;
      const k = kindOf(h.claim.tile);
      for (const c of options) mask[claimSlot(c, k)] = 1;
    }
  } else if (h.phase === 'end' && !h.ready[seat]) {
    mask[SLOT.ready] = 1;
  }
  return mask;
}

/** The engine Action for a slot (legal only if the slot is set in `legalMask`). */
export function decodeSlot(s: MatchState, seat: number, slot: number): Action {
  const h = s.hand;
  if (slot >= SLOT.discard && slot < SLOT.discard + 34) {
    const k = slot - SLOT.discard;
    const hand = h.players[seat]!.hand;
    const tile = hand.find((t) => kindOf(t) === k && t !== h.drawn) ?? hand.find((t) => kindOf(t) === k);
    if (tile === undefined) throw new Error(`no ${KIND_NAMES[k]} in hand`);
    return { type: 'discard', seat, tile };
  }
  if (slot === SLOT.tsumogiri) {
    if (h.drawn === null) throw new Error('nothing was drawn');
    return { type: 'discard', seat, tile: h.drawn };
  }
  if (slot >= SLOT.kong && slot < SLOT.kong + 34) return { type: 'kong', seat, kind: slot - SLOT.kong };
  if (slot === SLOT.tsumo) return { type: 'win', seat };
  if (slot === SLOT.ready) return { type: 'ready', seat };
  const k = h.claim ? kindOf(h.claim.tile) : -1;
  if (slot === SLOT.pass) return { type: 'claim', seat, claim: { type: 'pass' } };
  if (slot === SLOT.ron) return { type: 'claim', seat, claim: { type: 'win' } };
  if (slot === SLOT.pong) return { type: 'claim', seat, claim: { type: 'pong' } };
  if (slot === SLOT.claimKong) return { type: 'claim', seat, claim: { type: 'kong' } };
  if (slot >= SLOT.chi && slot < SLOT.chi + 3) return { type: 'claim', seat, claim: { type: 'chi', low: k - (slot - SLOT.chi) } };
  throw new Error(`no such slot ${slot}`);
}

/** The slot an engine Action falls in (imitation targets from the heuristic AI, replays). */
export function slotOf(s: MatchState, action: Action): number {
  const h = s.hand;
  switch (action.type) {
    case 'discard':
      return action.tile === h.drawn ? SLOT.tsumogiri : SLOT.discard + kindOf(action.tile);
    case 'kong':
      return SLOT.kong + action.kind;
    case 'win':
      return SLOT.tsumo;
    case 'claim':
      return claimSlot(action.claim, h.claim ? kindOf(h.claim.tile) : -1);
    case 'ready':
      return SLOT.ready;
    default:
      throw new Error(`no HK slot for a ${action.type} action`);
  }
}
