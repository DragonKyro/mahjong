import type { Tile } from '@core/tiles/Tile';
import type { Meld } from '@core/melds/Meld';
import type { WinContext } from '@core/game/types';
import type { WinValidator } from './WinValidator';
import type { RulesConfig } from './RulesConfig';
import { HandPatterns } from './HandPatterns';
import { FaanCalculator } from './FaanCalculator';

/**
 * Validator for HK Old Style rules: a win requires both (a) a legal winning
 * decomposition (4 sets + pair, or 七對, or 十三么) and (b) a faan total at or
 * above `config.minFaan` (default 3 — the 「三番起糊」 rule).
 */
export class HKOldStyleWinValidator implements WinValidator {
  private readonly faan: FaanCalculator;

  constructor(private readonly config: RulesConfig) {
    this.faan = new FaanCalculator(config);
  }

  canWin(input: {
    concealed: readonly Tile[];
    winningTile: Tile;
    exposedMelds: readonly Meld[];
    context: WinContext;
  }): boolean {
    if (!HandPatterns.canWin(input.concealed, input.winningTile, input.exposedMelds)) {
      return false;
    }
    const result = this.faan.calculate(
      input.concealed,
      input.winningTile,
      input.exposedMelds,
      input.context,
    );
    return result.total >= this.config.minFaan;
  }
}
