import type { Tile } from '@core/tiles/Tile';
import type { Meld } from '@core/melds/Meld';
import type { WinContext } from '@core/game/types';

/**
 * Decides whether a player is permitted to declare a win on the given winning tile.
 *
 * - `Round.possibleClaims` uses this to filter out illegal `win` options on
 *   another player's discard.
 * - `Round.runTurn` uses this to validate a self-drawn win.
 *
 * Implementations may also reject wins that fall below the configured faan
 * minimum (HK Old Style's 3-faan rule).
 */
export interface WinValidator {
  canWin(input: {
    concealed: readonly Tile[];
    winningTile: Tile;
    exposedMelds: readonly Meld[];
    context: WinContext;
  }): boolean;
}
