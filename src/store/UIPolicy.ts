import type { PlayerPolicy } from '@core/players/PlayerPolicy';
import type { Tile } from '@core/tiles/Tile';
import type { Wind } from '@core/tiles/HonorTile';
import type { TurnAction, Claim, PlayerView, WinContext } from '@core/game/types';
import type { WinValidator } from '@core/scoring/WinValidator';

export type ActionRequest = {
  view: PlayerView;
  drawn: Tile | null;
  /**
   * True when the engine's WinValidator approves a self-draw win on `drawn`. The
   * UI uses this to hide the "Declare win" button on incomplete or below-minFaan
   * hands. Computed conservatively — situational bonuses (嶺上開花, 海底撈月)
   * not knowable from the view default to false, so a hand that needs them to
   * reach minFaan will have the button hidden; the engine still validates if
   * the policy somehow returns `{ kind: 'win' }` anyway.
   */
  canDeclareWin: boolean;
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
  constructor(
    private readonly handlers: UIPolicyHandlers,
    private readonly winValidator?: WinValidator,
  ) {}

  chooseAction(view: PlayerView, drawn: Tile | null): Promise<TurnAction> {
    const canDeclareWin = this.computeCanDeclareWin(view, drawn);
    return new Promise((resolve) =>
      this.handlers.onActionRequest({ view, drawn, canDeclareWin, resolve }),
    );
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

  private computeCanDeclareWin(view: PlayerView, drawn: Tile | null): boolean {
    if (drawn === null) return false;
    if (!this.winValidator) return true; // trust mode (tests, no validator wired)
    const concealedSansDrawn = removeOneOccurrence(view.self.hand, drawn);
    const context: WinContext = {
      winnerSeat: view.self.seatWind,
      prevailingWind: view.prevailingWind,
      fromSeat: null,
      fromKongReplacement: false,
      fromKongRob: false,
      fromLastTile: false,
      bonusTiles: view.self.bonuses.map((b) => ({ category: b.category, index: b.index })),
    };
    return this.winValidator.canWin({
      concealed: concealedSansDrawn,
      winningTile: drawn,
      exposedMelds: view.self.melds,
      context,
    });
  }
}

function removeOneOccurrence(tiles: readonly Tile[], target: Tile): Tile[] {
  const out: Tile[] = [];
  let removed = false;
  for (const t of tiles) {
    if (!removed && t.equals(target)) {
      removed = true;
      continue;
    }
    out.push(t);
  }
  return out;
}
