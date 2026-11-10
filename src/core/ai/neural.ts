// Neural computer players. A variant listed in NEURAL_VARIANTS is played by
// trained networks instead of a heuristic AI: one network per difficulty level,
// loaded by the app (src/store/policies.ts) and registered here, so core code
// never imports the network runtime and the bundle only pays for it when a
// neural variant is actually played.
//
// The registry is the one piece of module state in core: a plain lookup table
// filled before a match starts. `chooseAction` throws if a seat's network is
// missing, so a forgotten load fails loudly instead of playing badly.

import type { Action, AiLevel, MatchConfig, MatchState } from '../engine';
import type { Kind } from '../tiles';
import type { VariantId } from '../variants';

export interface NeuralPlayer {
  /** The move for `seat`, or null when the game isn't waiting on it. Deterministic for a given state. */
  act(s: MatchState, seat: number): Action | null;
  /** The discard this player would make now (the UI hint), or null. */
  hint(s: MatchState, seat: number): Kind | null;
  /** What the file says about itself (training update, run). */
  meta: Record<string, unknown>;
}

/** Variants whose computer players are networks. */
export const NEURAL_VARIANTS: ReadonlySet<VariantId> = new Set<VariantId>(['hk']);

/** The level whose network gives hints: the strongest one. */
export const HINT_LEVEL: AiLevel = 'hard';

const players = new Map<string, NeuralPlayer>();
const key = (variant: VariantId, level: AiLevel) => `${variant}:${level}`;

export function registerNeural(variant: VariantId, level: AiLevel, player: NeuralPlayer): void {
  players.set(key(variant, level), player);
}

export function neuralPlayer(variant: VariantId, level: AiLevel): NeuralPlayer | null {
  return players.get(key(variant, level)) ?? null;
}

/** Forget every registered player (tests). */
export function clearNeural(): void {
  players.clear();
}

/** The levels of this match's computer seats that need a network (none for heuristic variants). */
export function neuralLevels(config: MatchConfig): AiLevel[] {
  if (!NEURAL_VARIANTS.has(config.variant)) return [];
  const levels = new Set<AiLevel>();
  for (const seat of config.seats) if (seat.ai) levels.add(seat.level ?? 'normal');
  return [...levels];
}
