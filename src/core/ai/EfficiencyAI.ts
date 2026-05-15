import type { PlayerPolicy } from '@core/players/PlayerPolicy';
import type { Tile } from '@core/tiles/Tile';
import type { Wind } from '@core/tiles/HonorTile';
import type { TurnAction, Claim, PlayerView } from '@core/game/types';
import { Shanten } from './Shanten';

/**
 * Efficiency-only AI: discards to minimise shanten and claims pong/kong when
 * the claim advances (or at least preserves) shanten. Always declares a win
 * when offered. Never chis (Phase 5 keeps the AI simple; defensive heuristics
 * and chi-evaluation arrive with `DefensiveAI`).
 */
export class EfficiencyAI implements PlayerPolicy {
  chooseAction(view: PlayerView, drawn: Tile | null): TurnAction {
    const exposedCount = view.self.melds.length;
    // Self-draw win if the 14-tile hand decomposes (shanten -1).
    if (drawn !== null && Shanten.count(view.self.hand, exposedCount) === -1) {
      return { kind: 'win' };
    }
    // If we have all four of a tile concealed, declare the kong (more faan, free draw).
    const fourOfAKind = findFourOfKind(view.self.hand);
    if (fourOfAKind !== null) {
      return { kind: 'self-kong', tile: fourOfAKind };
    }
    // Otherwise pick the shanten-minimising discard. The freshly drawn tile is
    // already in view.self.hand, so bestDiscard considers it.
    const { discard } = Shanten.bestDiscard(view.self.hand, exposedCount);
    return { kind: 'discard', tile: discard };
  }

  chooseClaim(
    view: PlayerView,
    discard: Tile,
    _from: Wind,
    options: readonly Claim[],
  ): Claim {
    // Always claim a win when offered.
    const winOpt = options.find((o) => o.kind === 'win');
    if (winOpt) return winOpt;

    const exposedCount = view.self.melds.length;
    const baseShanten = Shanten.count(view.self.hand, exposedCount);

    // Try each non-pass claim and see if it improves (or preserves) shanten.
    // For pong/kong: remove 2 or 3 of the discard from hand, add an exposed set,
    // check what the remaining hand's shanten is — claiming should not worsen
    // shanten by more than the value of the new set.
    const kongOpt = options.find((o) => o.kind === 'kong');
    if (kongOpt && shantenAfterPongOrKong(view, discard, 3) <= baseShanten) {
      return kongOpt;
    }
    const pongOpt = options.find((o) => o.kind === 'pong');
    if (pongOpt && shantenAfterPongOrKong(view, discard, 2) <= baseShanten) {
      return pongOpt;
    }
    // Skip chi for now — chi can break partials and is rarely shanten-positive
    // without contextual scoring.
    return { kind: 'pass' };
  }
}

function findFourOfKind(hand: readonly Tile[]): Tile | null {
  const counts = new Map<string, { tile: Tile; n: number }>();
  for (const t of hand) {
    const e = counts.get(t.toString());
    if (e) e.n++;
    else counts.set(t.toString(), { tile: t, n: 1 });
  }
  for (const v of counts.values()) {
    if (v.n === 4) return v.tile;
  }
  return null;
}

/**
 * Estimate the shanten of the hand AFTER claiming `discard` as part of a pong (uses 2 from hand)
 * or kong (uses 3 from hand). We remove the contributing tiles from concealed and treat the
 * meld as one extra exposed set when re-computing shanten.
 */
function shantenAfterPongOrKong(view: PlayerView, discard: Tile, fromHandCount: number): number {
  const remaining: Tile[] = [];
  let removed = 0;
  for (const t of view.self.hand) {
    if (removed < fromHandCount && t.equals(discard)) {
      removed++;
      continue;
    }
    remaining.push(t);
  }
  if (removed < fromHandCount) return Infinity; // not actually possible — defensive
  return Shanten.count(remaining, view.self.melds.length + 1);
}
