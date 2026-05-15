import type { Tile } from '@core/tiles/Tile';
import type { Wind } from '@core/tiles/HonorTile';
import type { TurnAction, Claim, PlayerView } from '@core/game/types';

/**
 * How a player makes decisions. The engine calls into a policy synchronously
 * whenever it needs a choice — for tests this is a scripted record, for AI it
 * will be a heuristic engine (Phase 5), and for human UI it will be a wrapper
 * around an async user-prompt (Phase 4) reified into the sync engine via the
 * Zustand store.
 *
 * Policies do not own any state — they read from the `PlayerView` they are
 * given. Two consecutive calls with the same view must return equivalent
 * decisions (referential transparency is helpful for replay/debugging).
 */
export interface PlayerPolicy {
  /**
   * The active player just drew `drawn` (or `null` if they took the turn via
   * chi/pong claim). Return a `discard`, `self-kong`, `add-kong`, or `win`.
   */
  chooseAction(view: PlayerView, drawn: Tile | null): TurnAction;

  /**
   * Another player discarded `discard`. The engine has filtered `options` to
   * only the claims this player can physically make from their hand (plus
   * `pass`). Return the chosen claim.
   */
  chooseClaim(
    view: PlayerView,
    discard: Tile,
    from: Wind,
    options: readonly Claim[],
  ): Claim;
}
