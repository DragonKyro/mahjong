import { Wall } from '@core/tiles/Wall';
import { Tile } from '@core/tiles/Tile';
import { SuitTile } from '@core/tiles/SuitTile';
import { Wind, SEAT_ORDER } from '@core/tiles/HonorTile';
import { Player } from '@core/players/Player';
import { Chi } from '@core/melds/Chi';
import { Pong } from '@core/melds/Pong';
import { Kong } from '@core/melds/Kong';
import type { WinValidator } from '@core/scoring/WinValidator';
import type { FaanCalculator } from '@core/scoring/FaanCalculator';
import type { TurnAction, Claim, PlayerView, RoundOutcome, WinContext } from './types';

export type SeatedPlayers = readonly [Player, Player, Player, Player];

/**
 * Orchestrates a single deal (局). Owns the wall and the four seated players,
 * and runs the turn loop to completion via the players' injected policies.
 *
 * Players must be supplied in seat order [East, South, West, North]; the
 * dealer is whichever seat is named in the constructor (East for the very
 * first round, then rotated by `Game`).
 *
 * Phase 2 scope: this class does not validate wins — it accepts `win` actions
 * and `win` claims from policies without checking that the hand actually
 * decomposes into 4 sets + 1 pair. Phase 3 plugs in `WinValidator` so the
 * engine can reject illegal win declarations.
 */
export class Round {
  readonly wall: Wall;
  readonly players: SeatedPlayers;
  readonly prevailingWind: Wind;
  readonly dealer: Wind;
  readonly winValidator: WinValidator | undefined;
  readonly faanCalculator: FaanCalculator | undefined;
  /**
   * Optional hook called after every turn (after the discard + claim resolution
   * has fully settled, before the next draw). The UI uses it to inject a small
   * pause so users can see AI actions land before the next AI moves.
   */
  readonly onTurnEnd: (() => void | Promise<void>) | undefined;

  private activeIdx: number;
  private lastDiscard: { tile: Tile; fromIdx: number } | null = null;
  private nextDraw: 'live' | 'replacement' | 'none' = 'live';
  /** True while the player just drew from the dead wall (after kong/bonus replacement). */
  private drewFromKongReplacement = false;

  constructor(
    players: SeatedPlayers,
    wall: Wall,
    prevailingWind: Wind,
    dealer: Wind,
    opts?: {
      winValidator?: WinValidator;
      faanCalculator?: FaanCalculator;
      onTurnEnd?: () => void | Promise<void>;
    },
  ) {
    if (players[0].seatWind !== Wind.East) {
      throw new Error('Round expects players in [East, South, West, North] order');
    }
    this.players = players;
    this.wall = wall;
    this.prevailingWind = prevailingWind;
    this.dealer = dealer;
    this.winValidator = opts?.winValidator;
    this.faanCalculator = opts?.faanCalculator;
    this.onTurnEnd = opts?.onTurnEnd;
    this.activeIdx = SEAT_ORDER.indexOf(dealer);
  }

  /** Run the round to completion and return how it ended. */
  async play(): Promise<RoundOutcome> {
    this.deal();

    while (true) {
      const outcome = await this.runTurn();
      if (outcome !== null) return outcome;
      if (this.onTurnEnd) await this.onTurnEnd();
    }
  }

  /** Deal 13 tiles to each player; bonus tiles draw replacements automatically. */
  private deal(): void {
    for (const player of this.players) {
      player.resetForRound();
    }
    for (let i = 0; i < 13; i++) {
      for (let p = 0; p < 4; p++) {
        const player = this.players[p]!;
        const tile = this.drawThroughBonuses(player, 'live');
        player.hand.add(tile);
      }
    }
  }

  /** Returns null to continue the loop, or a `RoundOutcome` to end the round. */
  private async runTurn(): Promise<RoundOutcome | null> {
    const active = this.players[this.activeIdx]!;

    // 1. Draw (or skip if entering this turn from a chi/pong claim).
    let drawn: Tile | null = null;
    this.drewFromKongReplacement = false;
    if (this.nextDraw === 'live') {
      if (this.wall.isLiveExhausted()) return { kind: 'draw', dealer: this.dealer };
      drawn = this.drawThroughBonuses(active, 'live');
      active.hand.add(drawn);
    } else if (this.nextDraw === 'replacement') {
      if (this.wall.deadRemaining() === 0) return { kind: 'draw', dealer: this.dealer };
      drawn = this.drawThroughBonuses(active, 'replacement');
      active.hand.add(drawn);
      this.drewFromKongReplacement = true;
    }

    // 2. Active player decides: discard, declare a kong (chained), or win.
    let action = await active.policy.chooseAction(this.viewFor(this.activeIdx), drawn);
    while (action.kind === 'self-kong' || action.kind === 'add-kong') {
      this.applyOwnKong(active, action);
      if (this.wall.deadRemaining() === 0) return { kind: 'draw', dealer: this.dealer };
      drawn = this.drawThroughBonuses(active, 'replacement');
      active.hand.add(drawn);
      this.drewFromKongReplacement = true;
      action = await active.policy.chooseAction(this.viewFor(this.activeIdx), drawn);
    }

    if (action.kind === 'win') {
      if (drawn === null) {
        throw new Error('Self-draw win requires a freshly drawn tile');
      }
      return this.finalizeSelfDrawWin(active, drawn);
    }

    // 3. Discard.
    const discarded = active.hand.remove(action.tile);
    active.recordDiscard(discarded);
    this.lastDiscard = { tile: discarded, fromIdx: this.activeIdx };

    // 4. Poll the other three players for claims.
    const bid = await this.resolveClaims(discarded, this.activeIdx);
    if (bid === null) {
      this.activeIdx = (this.activeIdx + 1) % 4;
      this.nextDraw = 'live';
      return null;
    }

    if (bid.claim.kind === 'win') {
      return this.finalizeDiscardWin(bid.playerIdx, this.activeIdx, discarded);
    }

    // The claimed tile is physically moved from the discard pile into the
    // claimer's exposed meld — remove it from the discarder's pile.
    active.discards.pop();
    this.applyDiscardClaim(discarded, bid.playerIdx, bid.claim);
    this.activeIdx = bid.playerIdx;
    this.nextDraw = bid.claim.kind === 'kong' ? 'replacement' : 'none';
    return null;
  }

  private finalizeSelfDrawWin(active: Player, winningTile: Tile): RoundOutcome {
    const concealedSansWin = removeOneOccurrence(active.hand.concealed, winningTile);
    const context: WinContext = {
      winnerSeat: active.seatWind,
      prevailingWind: this.prevailingWind,
      fromSeat: null,
      fromKongReplacement: this.drewFromKongReplacement,
      fromKongRob: false,
      fromLastTile: this.wall.isLiveExhausted() && !this.drewFromKongReplacement,
      bonusTiles: active.hand.bonuses.map((b) => ({ category: b.category, index: b.index })),
    };
    if (this.winValidator) {
      const ok = this.winValidator.canWin({
        concealed: concealedSansWin,
        winningTile,
        exposedMelds: active.hand.melds,
        context,
      });
      if (!ok) {
        throw new Error(
          `Player ${active.name} declared self-draw win but the configured validator rejected it`,
        );
      }
    }
    const faan = this.faanCalculator?.calculate(
      concealedSansWin,
      winningTile,
      active.hand.melds,
      context,
    );
    return {
      kind: 'win',
      winner: active.seatWind,
      from: null,
      winningTile,
      dealer: this.dealer,
      ...(faan ? { faan } : {}),
    };
  }

  private finalizeDiscardWin(
    claimerIdx: number,
    discarderIdx: number,
    winningTile: Tile,
  ): RoundOutcome {
    const claimer = this.players[claimerIdx]!;
    const discarder = this.players[discarderIdx]!;
    const context: WinContext = {
      winnerSeat: claimer.seatWind,
      prevailingWind: this.prevailingWind,
      fromSeat: discarder.seatWind,
      fromKongReplacement: false,
      fromKongRob: false,
      fromLastTile: this.wall.isLiveExhausted(),
      bonusTiles: claimer.hand.bonuses.map((b) => ({ category: b.category, index: b.index })),
    };
    const faan = this.faanCalculator?.calculate(
      claimer.hand.concealed,
      winningTile,
      claimer.hand.melds,
      context,
    );
    return {
      kind: 'win',
      winner: claimer.seatWind,
      from: discarder.seatWind,
      winningTile,
      dealer: this.dealer,
      ...(faan ? { faan } : {}),
    };
  }

  /** Pull tiles until a non-bonus appears; bonus tiles are routed to the player's bonus pile. */
  private drawThroughBonuses(player: Player, source: 'live' | 'replacement'): Tile {
    let tile = source === 'live' ? this.wall.draw() : this.wall.drawReplacement();
    while (tile.isBonus()) {
      player.hand.add(tile);
      if (this.wall.deadRemaining() === 0) {
        throw new Error('Dead wall exhausted while replacing a bonus tile');
      }
      tile = this.wall.drawReplacement();
    }
    return tile;
  }

  /** Apply a self-declared concealed kong or added kong. Tiles must be in hand. */
  private applyOwnKong(
    player: Player,
    action: Extract<TurnAction, { kind: 'self-kong' | 'add-kong' }>,
  ): void {
    if (action.kind === 'self-kong') {
      if (player.hand.countOf(action.tile) !== 4) {
        throw new Error(`Self-kong requires 4 of ${action.tile.toString()} in hand`);
      }
      const four: readonly [Tile, Tile, Tile, Tile] = [
        player.hand.remove(action.tile),
        player.hand.remove(action.tile),
        player.hand.remove(action.tile),
        player.hand.remove(action.tile),
      ];
      player.hand.exposeMeld(new Kong(four, 'concealed'));
      return;
    }
    // add-kong: must have an existing exposed pong of this tile, plus a 4th in hand.
    const existing = player.hand.melds.find(
      (m): m is Pong => m.type === 'pong' && m.tiles[0]!.equals(action.tile),
    );
    if (!existing) {
      throw new Error(`Add-kong requires an existing pong of ${action.tile.toString()}`);
    }
    if (player.hand.countOf(action.tile) < 1) {
      throw new Error(`Add-kong requires a 4th ${action.tile.toString()} in hand`);
    }
    const fourth = player.hand.remove(action.tile);
    const four: readonly [Tile, Tile, Tile, Tile] = [
      existing.tiles[0]!,
      existing.tiles[1]!,
      existing.tiles[2]!,
      fourth,
    ];
    player.hand.replaceMeld(existing, new Kong(four, 'added', existing.claimedFrom!));
  }

  /**
   * Apply a chi / pong / exposed-kong claim made on a discard. Removes the
   * helpers from the claimer's hand and exposes the meld.
   */
  private applyDiscardClaim(discard: Tile, claimerIdx: number, claim: Claim): void {
    const claimer = this.players[claimerIdx]!;
    const fromWind = this.players[this.lastDiscard!.fromIdx]!.seatWind;
    if (claim.kind === 'chi') {
      if (!discard.isSuit()) throw new Error('Chi requires a suit tile');
      const h1 = claimer.hand.remove(claim.helpers[0]);
      const h2 = claimer.hand.remove(claim.helpers[1]);
      claimer.hand.exposeMeld(
        new Chi([h1 as SuitTile, h2 as SuitTile, discard], {
          concealed: false,
          claimedFrom: fromWind,
        }),
      );
      return;
    }
    if (claim.kind === 'pong') {
      const a = claimer.hand.remove(discard);
      const b = claimer.hand.remove(discard);
      claimer.hand.exposeMeld(new Pong([a, b, discard], { concealed: false, claimedFrom: fromWind }));
      return;
    }
    if (claim.kind === 'kong') {
      const a = claimer.hand.remove(discard);
      const b = claimer.hand.remove(discard);
      const c = claimer.hand.remove(discard);
      claimer.hand.exposeMeld(new Kong([a, b, c, discard], 'exposed', fromWind));
      return;
    }
    throw new Error(`Unexpected claim kind in applyDiscardClaim: ${claim.kind}`);
  }

  /** Poll all non-discarders for claim choices and resolve by priority. */
  private async resolveClaims(
    discard: Tile,
    fromIdx: number,
  ): Promise<{ playerIdx: number; claim: Claim } | null> {
    type Bid = { playerIdx: number; claim: Claim };
    const winBids: Bid[] = [];
    const setBids: Bid[] = []; // pong + kong
    const chiBids: Bid[] = [];

    for (let i = 0; i < 4; i++) {
      if (i === fromIdx) continue;
      const options = this.possibleClaims(this.players[i]!, discard, fromIdx, i);
      if (options.length === 1) continue; // only `pass` available
      const chosen = await this.players[i]!.policy.chooseClaim(
        this.viewFor(i),
        discard,
        this.players[fromIdx]!.seatWind,
        options,
      );
      // Validate the chosen claim is among the options.
      if (!options.some((o) => claimsEquivalent(o, chosen))) {
        throw new Error(
          `Player ${this.players[i]!.name} chose claim ${JSON.stringify(chosen)} not in offered options`,
        );
      }
      if (chosen.kind === 'pass') continue;
      const bid = { playerIdx: i, claim: chosen };
      if (chosen.kind === 'win') winBids.push(bid);
      else if (chosen.kind === 'chi') chiBids.push(bid);
      else setBids.push(bid);
    }

    // Win > Pong/Kong > Chi. Within each tier, the closest to the discarder in
    // turn order wins (matters only for multi-win edge cases).
    const ordered = [winBids, setBids, chiBids];
    for (const tier of ordered) {
      if (tier.length === 0) continue;
      return tier.sort(
        (a, b) =>
          turnDistance(fromIdx, a.playerIdx) - turnDistance(fromIdx, b.playerIdx),
      )[0]!;
    }
    return null;
  }

  /**
   * Enumerate every claim the given player could make on `discard`.
   *
   * `win` is offered only when (a) no validator is configured (Phase 2 trust mode)
   * or (b) the configured validator approves the hypothetical winning hand.
   */
  private possibleClaims(player: Player, discard: Tile, fromIdx: number, byIdx: number): Claim[] {
    const out: Claim[] = [{ kind: 'pass' }];
    if (discard.isBonus()) return out;

    if (this.canClaimWin(player, discard, fromIdx)) {
      out.push({ kind: 'win' });
    }

    const matches = player.hand.countOf(discard);
    if (matches >= 2) out.push({ kind: 'pong' });
    if (matches >= 3) out.push({ kind: 'kong' });

    // Chi: only the player immediately after the discarder (下家 of discarder).
    if (discard.isSuit() && byIdx === (fromIdx + 1) % 4) {
      out.push(...findChiOptions(player.hand.concealed, discard));
    }

    return out;
  }

  private canClaimWin(player: Player, discard: Tile, fromIdx: number): boolean {
    if (!this.winValidator) return true;
    const context: WinContext = {
      winnerSeat: player.seatWind,
      prevailingWind: this.prevailingWind,
      fromSeat: this.players[fromIdx]!.seatWind,
      fromKongReplacement: false,
      fromKongRob: false,
      fromLastTile: this.wall.isLiveExhausted(),
      bonusTiles: player.hand.bonuses.map((b) => ({ category: b.category, index: b.index })),
    };
    return this.winValidator.canWin({
      concealed: player.hand.concealed,
      winningTile: discard,
      exposedMelds: player.hand.melds,
      context,
    });
  }

  /** Compute the read-only snapshot a given seat sees. */
  private viewFor(seatIdx: number): PlayerView {
    const self = this.players[seatIdx]!;
    const others = [];
    for (let i = 1; i <= 3; i++) {
      const idx = (seatIdx + i) % 4;
      const p = this.players[idx]!;
      others.push({
        seatWind: p.seatWind,
        melds: p.hand.melds,
        bonuses: p.hand.bonuses,
        discards: p.discards as readonly Tile[],
        handSize: p.hand.concealed.length,
      });
    }
    return {
      self: {
        seatWind: self.seatWind,
        hand: self.hand.concealed,
        melds: self.hand.melds,
        bonuses: self.hand.bonuses,
        discards: self.discards as readonly Tile[],
      },
      others,
      prevailingWind: this.prevailingWind,
      dealer: this.dealer,
      wallRemaining: this.wall.liveRemaining(),
      lastDiscard:
        this.lastDiscard === null
          ? null
          : {
              tile: this.lastDiscard.tile,
              from: this.players[this.lastDiscard.fromIdx]!.seatWind,
            },
    };
  }
}

/** Forward distance around the table from `fromIdx` to `toIdx` (1..3). */
function turnDistance(fromIdx: number, toIdx: number): number {
  return ((toIdx - fromIdx + 4) % 4) || 4;
}

function claimsEquivalent(a: Claim, b: Claim): boolean {
  if (a.kind !== b.kind) return false;
  if (a.kind === 'chi' && b.kind === 'chi') {
    return (
      (a.helpers[0].equals(b.helpers[0]) && a.helpers[1].equals(b.helpers[1])) ||
      (a.helpers[0].equals(b.helpers[1]) && a.helpers[1].equals(b.helpers[0]))
    );
  }
  return true;
}

/** Return `tiles` minus one occurrence of `target` (by equality). Used to peel the winning tile out of a concealed hand. */
function removeOneOccurrence(tiles: readonly Tile[], target: Tile): Tile[] {
  const out: Tile[] = [];
  let removed = false;
  for (const t of tiles) {
    if (!removed && t.equals(target)) {
      removed = true;
      continue;
    }
    out.push(t);
  }
  return out;
}

/** All chi combinations playable from `hand` against `discard`. */
function findChiOptions(hand: readonly Tile[], discard: SuitTile): Claim[] {
  const out: Claim[] = [];
  const sameSuit = hand.filter((t): t is SuitTile => t.isSuit() && t.suit === discard.suit);
  const find = (r: number): SuitTile | undefined => sameSuit.find((t) => t.rank === r);
  const r = discard.rank;
  for (const [d1, d2] of [
    [-2, -1],
    [-1, +1],
    [+1, +2],
  ] as const) {
    const t1 = find(r + d1);
    const t2 = find(r + d2);
    if (t1 && t2) {
      const helpers: readonly [SuitTile, SuitTile] = [t1, t2];
      out.push({ kind: 'chi', helpers });
    }
  }
  return out;
}
