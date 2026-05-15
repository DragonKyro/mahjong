import type { Tile } from '@core/tiles/Tile';
import type { Wind } from '@core/tiles/HonorTile';
import type { TurnAction, Claim, PlayerView } from '@core/game/types';

/**
 * How a player makes decisions. The engine awaits a policy whenever it needs a
 * choice — synchronous policies (AIs, scripted tests) simply return the value,
 * while the UI policy returns a Promise that resolves when the user clicks.
 *
 * Policies are not stateful — they read from the `PlayerView` they are given.
 */
export interface PlayerPolicy {
  /**
   * The active player just drew `drawn` (or `null` if they took the turn via
   * chi/pong claim). Return a `discard`, `self-kong`, `add-kong`, or `win`.
   */
  chooseAction(view: PlayerView, drawn: Tile | null): TurnAction | Promise<TurnAction>;

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
  ): Claim | Promise<Claim>;
}
