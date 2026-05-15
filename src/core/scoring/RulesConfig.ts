/**
 * Tunable HK Old Style scoring config. The defaults match a common 3-faan-minimum,
 * 13-faan-limit table with dealer doubling enabled. Liberal/new-style scoring will
 * subclass or override.
 */
export interface RulesConfig {
  /** Minimum faan total required to be eligible to win (under 3 = chicken hand, not enough). */
  minFaan: number;
  /** Maximum faan total — anything above is capped here (limit hand / 滿胡). */
  limitFaan: number;
  /** Base score unit; payouts scale from here according to the faan table. */
  baseUnit: number;
  /**
   * When true, the dealer (莊家) pays double on losses and receives double on wins.
   * Doublings stack: a dealer self-draw multiplies the loser-side base by 2.
   * This is standard HK Old Style; turn off for variants that omit dealer bonus.
   */
  dealerDoubling: boolean;
}

export const DEFAULT_RULES: RulesConfig = {
  minFaan: 3,
  limitFaan: 13,
  baseUnit: 1,
  dealerDoubling: true,
};
