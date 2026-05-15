import { Player } from './Player';

/**
 * A human-controlled seat. In Phase 1 this is just a concrete subclass so
 * `Player` stays abstract. Decision methods (discard choice, claim choice)
 * arrive with the turn loop in Phase 2.
 */
export class HumanPlayer extends Player {}
