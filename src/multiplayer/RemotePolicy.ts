import type { PlayerPolicy } from '@core/players/PlayerPolicy';
import type { Tile } from '@core/tiles/Tile';
import type { Wind } from '@core/tiles/HonorTile';
import type { TurnAction, Claim, PlayerView } from '@core/game/types';

/**
 * PlayerPolicy for a seat operated by another peer. The engine awaits a
 * decision; the multiplayer store resolves it when the matching message
 * arrives over the data channel.
 *
 * Lockstep invariant: only one action and at most one claim per seat can be
 * pending at any time (the engine polls sequentially, not concurrently).
 */
export class RemotePolicy implements PlayerPolicy {
  private actionResolve: ((a: TurnAction) => void) | null = null;
  private actionReject: ((e: Error) => void) | null = null;
  private claimResolve: ((c: Claim) => void) | null = null;
  private claimReject: ((e: Error) => void) | null = null;

  chooseAction(_view: PlayerView, _drawn: Tile | null): Promise<TurnAction> {
    if (this.actionResolve) {
      throw new Error('RemotePolicy.chooseAction: previous action still pending');
    }
    return new Promise<TurnAction>((resolve, reject) => {
      this.actionResolve = resolve;
      this.actionReject = reject;
    });
  }

  chooseClaim(
    _view: PlayerView,
    _discard: Tile,
    _from: Wind,
    _options: readonly Claim[],
  ): Promise<Claim> {
    if (this.claimResolve) {
      throw new Error('RemotePolicy.chooseClaim: previous claim still pending');
    }
    return new Promise<Claim>((resolve, reject) => {
      this.claimResolve = resolve;
      this.claimReject = reject;
    });
  }

  /** Called by the store when an action-decision message arrives for this seat. */
  receiveAction(action: TurnAction): void {
    if (!this.actionResolve) return; // ignore stale messages
    const r = this.actionResolve;
    this.actionResolve = null;
    this.actionReject = null;
    r(action);
  }

  /** Called by the store when a claim-decision message arrives for this seat. */
  receiveClaim(claim: Claim): void {
    if (!this.claimResolve) return;
    const r = this.claimResolve;
    this.claimResolve = null;
    this.claimReject = null;
    r(claim);
  }

  /** Called by the store on disconnect / shutdown to fail any in-flight wait. */
  abort(reason: string): void {
    const err = new Error(reason);
    if (this.actionReject) {
      const r = this.actionReject;
      this.actionReject = null;
      this.actionResolve = null;
      r(err);
    }
    if (this.claimReject) {
      const r = this.claimReject;
      this.claimReject = null;
      this.claimResolve = null;
      r(err);
    }
  }
}
