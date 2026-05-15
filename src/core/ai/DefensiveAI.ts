import type { PlayerPolicy } from '@core/players/PlayerPolicy';
import type { Tile } from '@core/tiles/Tile';
import type { Wind } from '@core/tiles/HonorTile';
import type { TurnAction, Claim, PlayerView } from '@core/game/types';
import { Shanten } from './Shanten';
import { Ukeire } from './Ukeire';

/**
 * Advanced-tier AI: efficiency first, then safety as a tiebreaker.
 *
 * Picks the discard with the lowest resulting shanten. Among options that tie
 * on shanten, prefers the safest tile against the three opponents — using two
 * cheap heuristics:
 *
 *   - **Genbutsu (現物)**: a tile already discarded by an opponent is safe
 *     against that opponent. They can't be waiting on it (under standard
 *     "no swap" mahjong etiquette — and we never see swap moves anyway).
 *   - **Suji (筋)**: for suit tiles, if an opponent has discarded the tile
 *     three ranks away in the same suit (e.g. they discarded 5m, so 2m and
 *     8m are "suji-safe"), they're unlikely to be waiting in a 兩面 shape
 *     for our tile. Not foolproof — kanchan / shanpon waits still bite —
 *     but a useful approximation.
 *
 * Final tiebreak: higher acceptance (better shape), then higher sort-key
 * (terminals/honors discarded before simples).
 *
 * Claim policy matches EfficiencyAI: always win, claim pong/kong when shanten
 * doesn't worsen, never chi.
 */
export class DefensiveAI implements PlayerPolicy {
  chooseAction(view: PlayerView, drawn: Tile | null): TurnAction {
    const exposedCount = view.self.melds.length;

    if (drawn !== null && Shanten.count(view.self.hand, exposedCount) === -1) {
      return { kind: 'win' };
    }
    const fourOfKind = findFourOfKind(view.self.hand);
    if (fourOfKind !== null) {
      return { kind: 'self-kong', tile: fourOfKind };
    }

    const visible = collectVisibleTiles(view);
    const analyses = Ukeire.analyzeAll(view.self.hand, exposedCount, visible);
    const minShanten = analyses.reduce((m, a) => Math.min(m, a.shanten), 8);
    const candidates = analyses.filter((a) => a.shanten === minShanten);

    const scored = candidates.map((a) => ({
      analysis: a,
      danger: dangerScore(a.discard, view),
    }));

    scored.sort((x, y) => {
      if (x.danger !== y.danger) return x.danger - y.danger;
      if (x.analysis.acceptance !== y.analysis.acceptance) {
        return y.analysis.acceptance - x.analysis.acceptance;
      }
      return y.analysis.discard.compareTo(x.analysis.discard);
    });

    return { kind: 'discard', tile: scored[0]!.analysis.discard };
  }

  chooseClaim(
    view: PlayerView,
    discard: Tile,
    _from: Wind,
    options: readonly Claim[],
  ): Claim {
    const win = options.find((o) => o.kind === 'win');
    if (win) return win;

    const exposed = view.self.melds.length;
    const base = Shanten.count(view.self.hand, exposed);

    const kong = options.find((o) => o.kind === 'kong');
    if (kong && shantenAfterClaim(view, discard, 3) <= base) return kong;
    const pong = options.find((o) => o.kind === 'pong');
    if (pong && shantenAfterClaim(view, discard, 2) <= base) return pong;
    return { kind: 'pass' };
  }
}

/** Collect every tile visible to this seat: own hand, melds, discards, plus opponents'. */
function collectVisibleTiles(view: PlayerView): Tile[] {
  const out: Tile[] = [...view.self.hand, ...view.self.discards];
  for (const m of view.self.melds) out.push(...m.tiles);
  for (const opp of view.others) {
    out.push(...opp.discards);
    for (const m of opp.melds) out.push(...m.tiles);
  }
  return out;
}

/**
 * Rough danger score for discarding `tile`, summed across the three opponents.
 *   0 (genbutsu)   — opponent has discarded this tile themselves
 *   1 (suji-safe)  — opponent has discarded the suji partner (rank ± 3, same suit)
 *   3 (unknown)    — neither
 * Honor tiles can only be genbutsu or unknown.
 */
function dangerScore(tile: Tile, view: PlayerView): number {
  let danger = 0;
  for (const opp of view.others) {
    if (opp.discards.some((d) => d.equals(tile))) continue; // genbutsu — safe
    if (tile.isSuit()) {
      const isSuji = opp.discards.some(
        (d) => d.isSuit() && d.suit === tile.suit && Math.abs(d.rank - tile.rank) === 3,
      );
      if (isSuji) {
        danger += 1;
        continue;
      }
    }
    danger += 3;
  }
  return danger;
}

function findFourOfKind(hand: readonly Tile[]): Tile | null {
  const counts = new Map<string, { tile: Tile; n: number }>();
  for (const t of hand) {
    const e = counts.get(t.toString());
    if (e) e.n++;
    else counts.set(t.toString(), { tile: t, n: 1 });
  }
  for (const v of counts.values()) {
    if (v.n === 4) return v.tile;
  }
  return null;
}

function shantenAfterClaim(view: PlayerView, discard: Tile, fromHandCount: number): number {
  const remaining: Tile[] = [];
  let removed = 0;
  for (const t of view.self.hand) {
    if (removed < fromHandCount && t.equals(discard)) {
      removed++;
      continue;
    }
    remaining.push(t);
  }
  if (removed < fromHandCount) return Infinity;
  return Shanten.count(remaining, view.self.melds.length + 1);
}
