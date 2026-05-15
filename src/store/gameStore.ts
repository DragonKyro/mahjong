import { create } from 'zustand';
import { Game } from '@core/game/Game';
import { HumanPlayer } from '@core/players/HumanPlayer';
import { ScriptedPolicy } from '@core/players/ScriptedPolicy';
import { Wind } from '@core/tiles/HonorTile';
import { mulberry32 } from '@utils/rng';
import type { RoundOutcome, TurnAction, Claim } from '@core/game/types';
import type { SeatedPlayers } from '@core/game/Round';
import { UIPolicy, type ActionRequest, type ClaimRequest } from './UIPolicy';

type PendingDecision =
  | ({ kind: 'action' } & ActionRequest)
  | ({ kind: 'claim' } & ClaimRequest);

interface GameStore {
  /** Active match. Null before the first round. */
  game: Game | null;
  /** Tick counter — bumped on every engine event so React re-derives. */
  tick: number;
  /** What the engine is currently asking the human player. */
  pending: PendingDecision | null;
  /** Result of the most recently completed round. */
  outcome: RoundOutcome | null;
  /** True while a round is mid-play. */
  inProgress: boolean;

  startRound: () => Promise<void>;
  resolveAction: (action: TurnAction) => void;
  resolveClaim: (claim: Claim) => void;
}

/**
 * Build four seated players: human at East, three passive AIs elsewhere.
 * The passive AI policy (Phase 4 placeholder) discards whatever it just drew
 * and never claims — Phase 5 will replace it with real heuristics.
 */
function buildPlayers(uiPolicy: UIPolicy): SeatedPlayers {
  const ai = new ScriptedPolicy();
  return [
    new HumanPlayer('You', Wind.East, uiPolicy),
    new HumanPlayer('South', Wind.South, ai),
    new HumanPlayer('West', Wind.West, ai),
    new HumanPlayer('North', Wind.North, ai),
  ];
}

export const useGameStore = create<GameStore>((set, get) => {
  const uiPolicy = new UIPolicy({
    onActionRequest: (req) => {
      set({ pending: { kind: 'action', ...req }, tick: get().tick + 1 });
    },
    onClaimRequest: (req) => {
      set({ pending: { kind: 'claim', ...req }, tick: get().tick + 1 });
    },
  });

  return {
    game: null,
    tick: 0,
    pending: null,
    outcome: null,
    inProgress: false,

    startRound: async () => {
      let game = get().game;
      if (!game) {
        const players = buildPlayers(uiPolicy);
        game = new Game(players);
        set({ game });
      }
      set({ outcome: null, pending: null, inProgress: true });
      try {
        const outcome = await game.playRound(mulberry32(Date.now()));
        set({ outcome, pending: null, inProgress: false, tick: get().tick + 1 });
      } catch (err) {
        // Engine threw (e.g. illegal action from a buggy policy). Surface the
        // error in the console for now; UI will catch this in a later sweep.
        console.error('Round failed:', err);
        set({ pending: null, inProgress: false });
      }
    },

    resolveAction: (action) => {
      const p = get().pending;
      if (p?.kind !== 'action') return;
      set({ pending: null });
      p.resolve(action);
    },

    resolveClaim: (claim) => {
      const p = get().pending;
      if (p?.kind !== 'claim') return;
      set({ pending: null });
      p.resolve(claim);
    },
  };
});
