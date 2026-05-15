import { create } from 'zustand';
import { Game } from '@core/game/Game';
import { HumanPlayer } from '@core/players/HumanPlayer';
import { Wind } from '@core/tiles/HonorTile';
import { mulberry32 } from '@utils/rng';
import { RandomAI } from '@core/ai/RandomAI';
import { EfficiencyAI } from '@core/ai/EfficiencyAI';
import { DefensiveAI } from '@core/ai/DefensiveAI';
import { HKOldStyleWinValidator } from '@core/scoring/HKOldStyleWinValidator';
import { DEFAULT_RULES } from '@core/scoring/RulesConfig';
import type { PlayerPolicy } from '@core/players/PlayerPolicy';
import type { RoundOutcome, TurnAction, Claim } from '@core/game/types';
import type { SeatedPlayers } from '@core/game/Round';
import { UIPolicy, type ActionRequest, type ClaimRequest } from './UIPolicy';

type PendingDecision =
  | ({ kind: 'action' } & ActionRequest)
  | ({ kind: 'claim' } & ClaimRequest);

export type Difficulty = 'beginner' | 'intermediate' | 'advanced';

const DIFFICULTY_LABEL: Record<Difficulty, string> = {
  beginner: 'Beginner (random discards)',
  intermediate: 'Intermediate (shanten-optimal)',
  advanced: 'Advanced (efficient + defensive)',
};

/** Pause between turns so the UI can render AI actions before the next AI moves. */
const TURN_END_DELAY_MS = 350;

interface GameStore {
  game: Game | null;
  difficulty: Difficulty;
  /** Tick counter — bumped on every engine event so React re-derives. */
  tick: number;
  /** What the engine is currently asking the human player. */
  pending: PendingDecision | null;
  /** Result of the most recently completed round. */
  outcome: RoundOutcome | null;
  /** True while a round is mid-play. */
  inProgress: boolean;

  setDifficulty: (d: Difficulty) => void;
  startRound: () => Promise<void>;
  resolveAction: (action: TurnAction) => void;
  resolveClaim: (claim: Claim) => void;
}

export const DIFFICULTIES: ReadonlyArray<{ value: Difficulty; label: string }> = (
  ['beginner', 'intermediate', 'advanced'] as const
).map((d) => ({ value: d, label: DIFFICULTY_LABEL[d] }));

function aiPolicyFor(difficulty: Difficulty): PlayerPolicy {
  if (difficulty === 'beginner') return new RandomAI();
  if (difficulty === 'advanced') return new DefensiveAI();
  return new EfficiencyAI();
}

function buildPlayers(uiPolicy: UIPolicy, difficulty: Difficulty): SeatedPlayers {
  return [
    new HumanPlayer('You', Wind.East, uiPolicy),
    new HumanPlayer('South', Wind.South, aiPolicyFor(difficulty)),
    new HumanPlayer('West', Wind.West, aiPolicyFor(difficulty)),
    new HumanPlayer('North', Wind.North, aiPolicyFor(difficulty)),
  ];
}

export const useGameStore = create<GameStore>((set, get) => {
  // Share one validator instance with the Game (which constructs its own equivalent
  // from DEFAULT_RULES). Both must agree on `canWin` so the UI's win-button gate
  // matches what the engine will accept.
  const winValidator = new HKOldStyleWinValidator(DEFAULT_RULES);
  const uiPolicy = new UIPolicy(
    {
      onActionRequest: (req) => {
        set({ pending: { kind: 'action', ...req }, tick: get().tick + 1 });
      },
      onClaimRequest: (req) => {
        set({ pending: { kind: 'claim', ...req }, tick: get().tick + 1 });
      },
    },
    winValidator,
  );

  const onTurnEnd = async (): Promise<void> => {
    set({ tick: get().tick + 1 });
    await new Promise((r) => setTimeout(r, TURN_END_DELAY_MS));
  };

  return {
    game: null,
    difficulty: 'intermediate',
    tick: 0,
    pending: null,
    outcome: null,
    inProgress: false,

    setDifficulty: (d) => {
      // Changing difficulty drops the in-progress game; the next startRound builds fresh players.
      set({ difficulty: d, game: null, outcome: null, pending: null });
    },

    startRound: async () => {
      let game = get().game;
      if (!game) {
        const players = buildPlayers(uiPolicy, get().difficulty);
        game = new Game(players, { onTurnEnd });
        set({ game });
      }
      set({ outcome: null, pending: null, inProgress: true });
      try {
        const outcome = await game.playRound(mulberry32(Date.now()));
        set({ outcome, pending: null, inProgress: false, tick: get().tick + 1 });
      } catch (err) {
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
