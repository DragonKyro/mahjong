import { shuffleInPlace, type RNG } from '@utils/rng';
import { Tile } from './Tile';
import { SuitTile, Suit, type SuitRank } from './SuitTile';
import { HonorTile, Wind, Dragon } from './HonorTile';
import { BonusTile, type BonusCategory, type BonusIndex } from './BonusTile';

/** 3 suits × 9 ranks × 4 + 4 winds × 4 + 3 dragons × 4 + 4 flowers + 4 seasons. */
export const TOTAL_TILES = 144;

/** Tiles reserved at the back of the wall for kong / bonus replacement draws (王牌). */
export const DEAD_WALL_SIZE = 14;

const ALL_SUITS = [Suit.Character, Suit.Circle, Suit.Bamboo] as const;
const ALL_WINDS = [Wind.East, Wind.South, Wind.West, Wind.North] as const;
const ALL_DRAGONS = [Dragon.Red, Dragon.Green, Dragon.White] as const;
const ALL_BONUS_CATEGORIES: readonly BonusCategory[] = ['flower', 'season'];

/**
 * The full 144-tile Cantonese wall. Tiles are shuffled with the injected RNG so
 * the engine never calls Math.random() (required for replayable training and
 * host-verifiable multiplayer shuffles).
 *
 * Live draws come from the front (`liveHead++`); replacement draws come from
 * the back of the dead wall (`deadOffset++`). When the live wall reaches the
 * dead wall, the hand ends in a draw (流局).
 */
export class Wall {
  private readonly tiles: readonly Tile[];
  private liveHead = 0;
  private deadOffset = 0;

  constructor(input: RNG | { tiles: readonly Tile[] }) {
    if (typeof input === 'function') {
      const arr = Wall.buildFullSet();
      shuffleInPlace(arr, input);
      this.tiles = arr;
    } else {
      if (input.tiles.length !== TOTAL_TILES) {
        throw new Error(`Wall needs ${TOTAL_TILES} tiles, got ${input.tiles.length}`);
      }
      this.tiles = input.tiles.slice();
    }
  }

  /**
   * Test-only factory for rigged scenarios: build a wall in a caller-provided tile
   * order, skipping the shuffle. Live draws come from index 0 upward; the last
   * DEAD_WALL_SIZE tiles serve as the dead wall (drawn from the end downward).
   */
  static fromOrder(tiles: readonly Tile[]): Wall {
    return new Wall({ tiles });
  }

  /** Builds an unshuffled tileset. Exposed for tests; do not use in gameplay. */
  static buildFullSet(): Tile[] {
    const out: Tile[] = [];
    for (const suit of ALL_SUITS) {
      for (let rank = 1; rank <= 9; rank++) {
        for (let copy = 0; copy < 4; copy++) {
          out.push(new SuitTile(suit, rank as SuitRank));
        }
      }
    }
    for (const wind of ALL_WINDS) {
      for (let copy = 0; copy < 4; copy++) {
        out.push(new HonorTile(wind));
      }
    }
    for (const dragon of ALL_DRAGONS) {
      for (let copy = 0; copy < 4; copy++) {
        out.push(new HonorTile(dragon));
      }
    }
    for (const category of ALL_BONUS_CATEGORIES) {
      for (let i = 1; i <= 4; i++) {
        out.push(new BonusTile(category, i as BonusIndex));
      }
    }
    return out;
  }

  /** Draw the next tile from the live wall (the active player's turn). */
  draw(): Tile {
    if (this.liveRemaining() === 0) {
      throw new Error('Wall exhausted — hand should have ended');
    }
    const tile = this.tiles[this.liveHead]!;
    this.liveHead++;
    return tile;
  }

  /** Draw a replacement tile from the dead wall (after kong or bonus). */
  drawReplacement(): Tile {
    if (this.deadRemaining() === 0) {
      throw new Error('Dead wall exhausted — too many kongs / bonuses');
    }
    const tile = this.tiles[this.tiles.length - 1 - this.deadOffset]!;
    this.deadOffset++;
    return tile;
  }

  liveRemaining(): number {
    return Math.max(0, this.tiles.length - DEAD_WALL_SIZE - this.liveHead);
  }

  deadRemaining(): number {
    return DEAD_WALL_SIZE - this.deadOffset;
  }

  totalRemaining(): number {
    return this.liveRemaining() + this.deadRemaining();
  }

  isLiveExhausted(): boolean {
    return this.liveRemaining() === 0;
  }
}
