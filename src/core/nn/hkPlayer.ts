// A trained HK network as a computer player: plays greedily (so a state always
// gets the same move, which the online AI driver and tests rely on) and offers
// the UI a suggested discard. Loaded lazily by src/store/policies.ts.

import type { MatchState } from '../engine';
import type { NeuralPlayer } from '../ai/neural';
import { kindOf, type Kind } from '../tiles';
import { SLOT, legalMask } from './hkActions';
import { observe } from './hkEncode';
import { loadHkNet, maskedArgmax, netAction, type HkNet } from './hkNet';

export function hkPlayer(net: HkNet): NeuralPlayer {
  // The hint is asked on every render of the table; compute it once per state.
  const hints = new WeakMap<MatchState, { seat: number; kind: Kind | null }>();
  return {
    meta: net.meta,
    act: (s, seat) => netAction(s, seat, net),
    hint(s, seat) {
      const h = s.hand;
      if (s.over || h.phase !== 'act' || h.turn !== seat) return null;
      const cached = hints.get(s);
      if (cached && cached.seat === seat) return cached.kind;
      // The best discard (a throw of the drawn tile counts), whatever the net would do overall.
      const mask = legalMask(s, seat);
      const discards = mask.map((x, i) => (x && i <= SLOT.tsumogiri ? 1 : 0));
      let kind: Kind | null = null;
      if (discards.some(Boolean)) {
        const slot = maskedArgmax(net.forward(observe(s, seat, mask)).logits, discards);
        kind = slot === SLOT.tsumogiri ? (h.drawn === null ? null : kindOf(h.drawn)) : slot - SLOT.discard;
      }
      hints.set(s, { seat, kind });
      return kind;
    },
  };
}

/** A network file's bytes → a player. */
export function loadHkPlayer(bytes: Uint8Array | ArrayBuffer): NeuralPlayer {
  return hkPlayer(loadHkNet(bytes));
}
