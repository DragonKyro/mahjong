import type { Tile } from '@core/tiles/Tile';
import type { Wind } from '@core/tiles/HonorTile';
import type { TurnAction, Claim, PlayerView } from '@core/game/types';
import type { PlayerPolicy } from './PlayerPolicy';

export type ChooseActionFn = (view: PlayerView, drawn: Tile | null) => TurnAction;
export type ChooseClaimFn = (
  view: PlayerView,
  discard: Tile,
  from: Wind,
  options: readonly Claim[],
) => Claim;

/**
 * Test- and debugging-friendly policy. Custom `chooseAction` / `chooseClaim`
 * functions can be injected; the defaults play a sensible "boring" game:
 * discard the just-drawn tile, never claim. Useful for end-to-end round tests
 * that don't care about decision-making — they just want the turn loop to
 * make progress until something interesting happens.
 */
export class ScriptedPolicy implements PlayerPolicy {
  private readonly actionFn: ChooseActionFn;
  private readonly claimFn: ChooseClaimFn;

  constructor(opts?: { chooseAction?: ChooseActionFn; chooseClaim?: ChooseClaimFn }) {
    this.actionFn = opts?.chooseAction ?? ScriptedPolicy.defaultAction;
    this.claimFn = opts?.chooseClaim ?? ScriptedPolicy.defaultClaim;
  }

  chooseAction(view: PlayerView, drawn: Tile | null): TurnAction {
    return this.actionFn(view, drawn);
  }

  chooseClaim(view: PlayerView, discard: Tile, from: Wind, options: readonly Claim[]): Claim {
    return this.claimFn(view, discard, from, options);
  }

  /** Default action: discard whatever was just drawn, else the last concealed tile. */
  static defaultAction: ChooseActionFn = (view, drawn) => {
    if (drawn !== null && !drawn.isBonus()) {
      return { kind: 'discard', tile: drawn };
    }
    const last = view.self.hand[view.self.hand.length - 1];
    if (!last) throw new Error('ScriptedPolicy.defaultAction: empty hand, nothing to discard');
    return { kind: 'discard', tile: last };
  };

  /** Default claim: always pass. */
  static defaultClaim: ChooseClaimFn = () => ({ kind: 'pass' });
}
