import type { WinValidator } from './WinValidator';

/**
 * Accepts every claimed win unconditionally. Useful for tests and for the engine
 * default before Phase 3 introduced strict HK-style validation — Round still
 * trusts the policy when this validator is supplied.
 */
export class PermissiveWinValidator implements WinValidator {
  canWin(): boolean {
    return true;
  }
}
