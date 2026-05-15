import type { PlayerPolicy } from '@core/players/PlayerPolicy';
import type { Tile } from '@core/tiles/Tile';
import type { Wind } from '@core/tiles/HonorTile';
import type { TurnAction, Claim, PlayerView } from '@core/game/types';

export type ActionRequest = {
  view: PlayerView;
  drawn: Tile | null;
  resolve: (a: TurnAction) => void;
};

export type ClaimRequest = {
  view: PlayerView;
  discard: Tile;
  from: Wind;
  options: readonly Claim[];
  resolve: (c: Claim) => void;
};

export interface UIPolicyHandlers {
  onActionRequest: (req: ActionRequest) => void;
  onClaimRequest: (req: ClaimRequest) => void;
}

/**
 * PlayerPolicy that defers every decision to the UI: each request hands a
 * `resolve` callback to the handler, returns a Promise, and parks the engine
 * until the user clicks something that calls `resolve(decision)`.
 *
 * The store binds the handlers to its `setPending` action and the React UI
 * binds buttons to `resolvePending`.
 */
export class UIPolicy implements PlayerPolicy {
  constructor(private readonly handlers: UIPolicyHandlers) {}

  chooseAction(view: PlayerView, drawn: Tile | null): Promise<TurnAction> {
    return new Promise((resolve) => this.handlers.onActionRequest({ view, drawn, resolve }));
  }

  chooseClaim(
    view: PlayerView,
    discard: Tile,
    from: Wind,
    options: readonly Claim[],
  ): Promise<Claim> {
    return new Promise((resolve) =>
      this.handlers.onClaimRequest({ view, discard, from, options, resolve }),
    );
  }
}
