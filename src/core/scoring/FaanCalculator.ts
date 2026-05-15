import { Tile } from '@core/tiles/Tile';
import { Suit } from '@core/tiles/SuitTile';
import { Wind, Dragon } from '@core/tiles/HonorTile';
import { Meld } from '@core/melds/Meld';
import type { WinContext, FaanEntry, FaanResult } from '@core/game/types';
import type { RulesConfig } from './RulesConfig';
import type {
  WinningHand,
  StandardDecomposition,
  SevenPairsDecomposition,
} from './HandPatterns';
import { HandPatterns } from './HandPatterns';

type FaanPushFn = (entry: FaanEntry) => void;
type DiscoveredSetKind = 'chi' | 'pong' | 'kong';

/**
 * HK Old Style faan calculator. Given a winning hand and situational context,
 * returns matched faan entries and a total capped at `config.limitFaan`.
 *
 * The calculator never *rejects* a hand — that's WinValidator's job. It also does
 * not enforce the min-faan rule; callers compare `result.total >= config.minFaan`.
 *
 * When a hand admits multiple decompositions the calculator scores each and
 * returns the highest-scoring one.
 */
export class FaanCalculator {
  constructor(private readonly config: RulesConfig) {}

  /** Pick the best decomposition of the winning hand and return its faan tally. */
  calculate(
    concealed: readonly Tile[],
    winningTile: Tile,
    exposedMelds: readonly Meld[],
    context: WinContext,
  ): FaanResult {
    const decomps = HandPatterns.findWinningDecompositions(concealed, winningTile, exposedMelds);
    if (decomps.length === 0) {
      return { entries: [], total: 0, isLimit: false };
    }
    let best: FaanResult | null = null;
    for (const d of decomps) {
      const r = this.scoreDecomposition(d, context);
      if (best === null || r.total > best.total) best = r;
    }
    return best ?? { entries: [], total: 0, isLimit: false };
  }

  /** Score a single pre-decomposed hand. Exposed for unit tests. */
  scoreDecomposition(hand: WinningHand, context: WinContext): FaanResult {
    const entries: FaanEntry[] = [];
    const push: FaanPushFn = (e) => entries.push(e);

    if (hand.kind === 'thirteen-orphans') {
      push({
        id: 'thirteen-orphans',
        label: '十三么 (Thirteen Orphans)',
        faan: this.config.limitFaan,
      });
    } else if (hand.kind === 'seven-pairs') {
      this.scoreSevenPairs(hand, push);
    } else {
      this.scoreStandard(hand, context, push);
    }

    this.scoreSituational(context, push);
    this.scoreBonus(context, push);

    const raw = entries.reduce((sum, e) => sum + e.faan, 0);
    const isLimit = raw >= this.config.limitFaan;
    return { entries, total: Math.min(raw, this.config.limitFaan), isLimit };
  }

  // ---------- 七對 ----------

  private scoreSevenPairs(hand: SevenPairsDecomposition, push: FaanPushFn): void {
    push({ id: 'seven-pairs', label: '七對 (Seven Pairs)', faan: 4 });
    const suit = analyzeSuitPurity(hand.pairs);
    if (suit === 'flush') push({ id: 'full-flush', label: '清一色 (Full Flush)', faan: 6 });
    else if (suit === 'half-flush')
      push({ id: 'half-flush', label: '混一色 (Half Flush)', faan: 3 });
    else if (suit === 'all-honors')
      push({ id: 'all-honors', label: '字一色 (All Honors)', faan: this.config.limitFaan });
    // Seven pairs is always concealed.
    push({ id: 'concealed-hand', label: '門前清 (Concealed Hand)', faan: 1 });
  }

  // ---------- Standard 4-set + pair ----------

  private scoreStandard(
    hand: StandardDecomposition,
    context: WinContext,
    push: FaanPushFn,
  ): void {
    const setKinds = hand.allSets.map((s) => s.kind as DiscoveredSetKind);
    if (setKinds.every((k) => k === 'chi')) {
      push({ id: 'all-chi', label: '平和 (All Sequences)', faan: 1 });
    }
    if (setKinds.every((k) => k === 'pong' || k === 'kong')) {
      push({ id: 'all-triplets', label: '對對和 (All Triplets)', faan: 3 });
    }

    const allTiles = [hand.pairTile, ...hand.allSets.flatMap((s) => s.tiles)];
    const suit = analyzeSuitPurity(allTiles);
    if (suit === 'flush') push({ id: 'full-flush', label: '清一色 (Full Flush)', faan: 6 });
    else if (suit === 'half-flush')
      push({ id: 'half-flush', label: '混一色 (Half Flush)', faan: 3 });
    else if (suit === 'all-honors')
      push({ id: 'all-honors', label: '字一色 (All Honors)', faan: this.config.limitFaan });

    const dragons = countDragonGroups(hand);
    if (dragons.pongs === 3) {
      push({
        id: 'big-three-dragons',
        label: '大三元 (Big Three Dragons)',
        faan: this.config.limitFaan,
      });
    } else if (dragons.pongs === 2 && dragons.pair) {
      push({ id: 'small-three-dragons', label: '小三元 (Small Three Dragons)', faan: 4 });
    }

    const winds = countWindGroups(hand);
    if (winds.pongs === 4) {
      push({
        id: 'big-four-winds',
        label: '大四喜 (Big Four Winds)',
        faan: this.config.limitFaan,
      });
    } else if (winds.pongs === 3 && winds.pair) {
      push({ id: 'small-four-winds', label: '小四喜 (Small Four Winds)', faan: 6 });
    }

    // Per-set faan: 中發白 pongs/kongs (1 each), seat wind (1), prevailing wind (1).
    for (const set of hand.allSets) {
      if (set.kind !== 'pong' && set.kind !== 'kong') continue;
      const t = set.tiles[0];
      if (!t || !t.isHonor()) continue;
      const h = t.honor;
      if (h === Dragon.Red || h === Dragon.Green || h === Dragon.White) {
        push({ id: `dragon-${h}`, label: `${dragonLabel(h)} pong`, faan: 1 });
      } else if (h === context.winnerSeat) {
        push({ id: 'seat-wind', label: '門風 (Seat Wind)', faan: 1 });
      }
      if (h === context.prevailingWind) {
        push({ id: 'prevailing-wind', label: '圈風 (Prevailing Wind)', faan: 1 });
      }
    }

    if (hand.exposedMelds.length === 0) {
      push({ id: 'concealed-hand', label: '門前清 (Concealed Hand)', faan: 1 });
    }
  }

  // ---------- Situational ----------

  private scoreSituational(context: WinContext, push: FaanPushFn): void {
    if (context.fromSeat === null) {
      push({ id: 'self-draw', label: '自摸 (Self-Draw)', faan: 1 });
    }
    if (context.fromKongReplacement) {
      push({ id: 'kong-replacement', label: '嶺上開花 (Win on Kong Replacement)', faan: 1 });
    }
    if (context.fromKongRob) {
      push({ id: 'rob-the-kong', label: '搶槓 (Robbing the Kong)', faan: 1 });
    }
    if (context.fromLastTile) {
      push({
        id: 'last-tile',
        label:
          context.fromSeat === null ? '海底撈月 (Last Tile Self-Draw)' : '河底撈魚 (Last Tile Discard)',
        faan: 1,
      });
    }
  }

  // ---------- Bonus tiles ----------

  private scoreBonus(context: WinContext, push: FaanPushFn): void {
    const seatIdx = seatIndex(context.winnerSeat);
    for (const b of context.bonusTiles) {
      if (b.index - 1 === seatIdx) {
        push({
          id: `bonus-${b.category}-${b.index}`,
          label: `花/季 matching seat (${context.winnerSeat})`,
          faan: 1,
        });
      }
    }
  }
}

// ---------- Helpers ----------

type SuitPurity = 'mixed' | 'flush' | 'half-flush' | 'all-honors';

function analyzeSuitPurity(tiles: readonly Tile[]): SuitPurity {
  let suit: Suit | null = null;
  let hasHonor = false;
  let hasSuit = false;
  for (const t of tiles) {
    if (t.isHonor()) {
      hasHonor = true;
    } else if (t.isSuit()) {
      hasSuit = true;
      if (suit === null) suit = t.suit;
      else if (suit !== t.suit) return 'mixed';
    }
  }
  if (hasSuit && hasHonor) return 'half-flush';
  if (hasSuit && !hasHonor) return 'flush';
  if (!hasSuit && hasHonor) return 'all-honors';
  return 'mixed';
}

function countDragonGroups(hand: StandardDecomposition): { pongs: number; pair: boolean } {
  let pongs = 0;
  for (const set of hand.allSets) {
    if (set.kind !== 'pong' && set.kind !== 'kong') continue;
    const t = set.tiles[0];
    if (t && t.isHonor() && isDragon(t.honor)) pongs++;
  }
  const pair = hand.pairTile.isHonor() && isDragon(hand.pairTile.honor);
  return { pongs, pair };
}

function countWindGroups(hand: StandardDecomposition): { pongs: number; pair: boolean } {
  let pongs = 0;
  for (const set of hand.allSets) {
    if (set.kind !== 'pong' && set.kind !== 'kong') continue;
    const t = set.tiles[0];
    if (t && t.isHonor() && isWind(t.honor)) pongs++;
  }
  const pair = hand.pairTile.isHonor() && isWind(hand.pairTile.honor);
  return { pongs, pair };
}

function isWind(h: string): boolean {
  return h === Wind.East || h === Wind.South || h === Wind.West || h === Wind.North;
}

function isDragon(h: string): boolean {
  return h === Dragon.Red || h === Dragon.Green || h === Dragon.White;
}

function dragonLabel(h: string): string {
  if (h === Dragon.Red) return '中 (Red Dragon)';
  if (h === Dragon.Green) return '發 (Green Dragon)';
  if (h === Dragon.White) return '白 (White Dragon)';
  return h;
}

function seatIndex(w: Wind): number {
  if (w === Wind.East) return 0;
  if (w === Wind.South) return 1;
  if (w === Wind.West) return 2;
  return 3;
}
