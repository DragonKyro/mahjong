import type { Tile } from '@core/tiles/Tile';
import type { SuitTile } from '@core/tiles/SuitTile';
import type { BonusTile } from '@core/tiles/BonusTile';
import type { Wind } from '@core/tiles/HonorTile';
import type { Meld } from '@core/melds/Meld';

/**
 * Decisions a player can make on their own turn after drawing (or after a chi/pong
 * claim, in which case `drawn` is null and they must discard).
 */
export type TurnAction =
  | { kind: 'discard'; tile: Tile }
  | { kind: 'self-kong'; tile: Tile } // concealed kong declared from 4 in hand (暗槓)
  | { kind: 'add-kong'; tile: Tile } // promote an existing exposed pong to a kong (加槓)
  | { kind: 'win' }; // self-drawn win (自摸)

/**
 * Decisions a player can make on someone else's discard. `pass` is always an option;
 * the engine offers other variants only when they are physically possible from the
 * player's hand (so policies can rely on `options` containing only legal claims).
 */
export type Claim =
  | { kind: 'pass' }
  | { kind: 'chi'; helpers: readonly [SuitTile, SuitTile] }
  | { kind: 'pong' }
  | { kind: 'kong' } // exposed kong from a discard (明槓)
  | { kind: 'win' }; // ron / discard win (食糊)

/**
 * What a player sees when asked to make a decision. The active player's own hand is
 * visible only via `self.hand`; opponents' concealed tiles are summarized as counts.
 * This is the same shape we will eventually send across the WebRTC channel in
 * multiplayer — keeping it serializable from the start.
 */
export interface PlayerView {
  self: {
    seatWind: Wind;
    hand: readonly Tile[];
    melds: readonly Meld[];
    bonuses: readonly BonusTile[];
    discards: readonly Tile[];
  };
  others: ReadonlyArray<{
    seatWind: Wind;
    melds: readonly Meld[];
    bonuses: readonly BonusTile[];
    discards: readonly Tile[];
    handSize: number;
  }>;
  prevailingWind: Wind;
  dealer: Wind;
  wallRemaining: number;
  /** The most recent discard, if a turn has happened. */
  lastDiscard: { tile: Tile; from: Wind } | null;
}

/**
 * Situational facts that contribute faan but cannot be inferred from the hand
 * alone. Populated by `Round` when a win condition is reached and threaded into
 * the FaanCalculator.
 */
export interface WinContext {
  winnerSeat: Wind;
  prevailingWind: Wind;
  /** null = self-draw (自摸); else the seat that discarded the winning tile. */
  fromSeat: Wind | null;
  /** Win on the tile drawn from the dead wall after a kong (嶺上開花). */
  fromKongReplacement: boolean;
  /** Win on robbing an added-kong (搶槓). */
  fromKongRob: boolean;
  /** Win on the last live-wall tile (海底撈月 / 河底撈魚). */
  fromLastTile: boolean;
  /** Bonus tiles already in the winner's bonus pile at win time. */
  bonusTiles: readonly { category: 'flower' | 'season'; index: 1 | 2 | 3 | 4 }[];
}

export interface FaanEntry {
  /** Stable ID for the rule, e.g. 'all-chi', 'big-three-dragons'. */
  id: string;
  /** Display label in English / 中文. */
  label: string;
  /** Faan points awarded by this rule. */
  faan: number;
}

export interface FaanResult {
  entries: readonly FaanEntry[];
  /** Sum of entries, capped at the rules config `limitFaan`. */
  total: number;
  /** True if the uncapped total met or exceeded `limitFaan`. */
  isLimit: boolean;
}

/** Why a round ended. `from === null` means 自摸 (self-draw). */
export type RoundOutcome =
  | {
      kind: 'win';
      winner: Wind;
      from: Wind | null;
      winningTile: Tile;
      /** Dealer at the moment the round ended (before any post-round rotation). */
      dealer: Wind;
      /** Present when a WinValidator + FaanCalculator are configured on the Round. */
      faan?: FaanResult;
    }
  | { kind: 'draw'; dealer: Wind }; // 流局
