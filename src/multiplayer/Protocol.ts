import { Tile } from '@core/tiles/Tile';
import { Suit, SuitTile, type SuitRank } from '@core/tiles/SuitTile';
import {
  HonorTile,
  Wind,
  Dragon,
  type Honor,
} from '@core/tiles/HonorTile';
import { BonusTile, type BonusCategory, type BonusIndex } from '@core/tiles/BonusTile';
import type { TurnAction, Claim } from '@core/game/types';

/**
 * Wire-format types and (de)serializers for messages sent over the WebRTC data
 * channel. Tile objects don't survive JSON.stringify, so every payload uses the
 * tile's `toString()` form (e.g. "3m", "E", "F1") and is rehydrated on receive.
 *
 * Keep this file pure — no DOM, no PeerJS, no React. It must be testable under
 * Node without any browser globals.
 */

export type SeatName = 'E' | 'S' | 'W' | 'N';
export type WireTile = string;

export type WireTurnAction =
  | { kind: 'discard'; tile: WireTile }
  | { kind: 'self-kong'; tile: WireTile }
  | { kind: 'add-kong'; tile: WireTile }
  | { kind: 'win' };

export type WireClaim =
  | { kind: 'pass' }
  | { kind: 'chi'; helpers: [WireTile, WireTile] }
  | { kind: 'pong' }
  | { kind: 'kong' }
  | { kind: 'win' };

export interface LobbyEntry {
  peerId: string;
  seat: SeatName;
  name: string;
}

export type RoomMessage =
  /** Sent client → host on connect, then host → all on every roster change. */
  | { type: 'hello'; peerId: string; name: string }
  | { type: 'lobby-update'; players: LobbyEntry[] }
  /** Sent host → all to kick off the round. All peers seed identical engines. */
  | { type: 'start-round'; seed: number; dealer: SeatName }
  /** Sent by the deciding peer → host → all when an action / claim resolves. */
  | { type: 'action-decision'; seat: SeatName; action: WireTurnAction }
  | { type: 'claim-decision'; seat: SeatName; claim: WireClaim }
  /** Sent by host on intentional shutdown so clients can return to lobby. */
  | { type: 'host-left' };

// ---------- Wind <-> SeatName ----------

export function windToSeat(w: Wind): SeatName {
  if (w === Wind.East) return 'E';
  if (w === Wind.South) return 'S';
  if (w === Wind.West) return 'W';
  return 'N';
}

export function seatToWind(s: SeatName): Wind {
  if (s === 'E') return Wind.East;
  if (s === 'S') return Wind.South;
  if (s === 'W') return Wind.West;
  return Wind.North;
}

// ---------- Tile (de)serialization ----------

export function tileToWire(t: Tile): WireTile {
  return t.toString();
}

export function wireToTile(s: WireTile): Tile {
  if (s.length === 1) {
    return new HonorTile(s as Honor);
  }
  if (s.length === 2) {
    const a = s[0]!;
    const b = s[1]!;
    if (a >= '1' && a <= '9' && (b === 'm' || b === 'p' || b === 's')) {
      const rank = Number(a) as SuitRank;
      const suit = b as Suit;
      return new SuitTile(suit, rank);
    }
    if ((a === 'F' || a === 'S') && b >= '1' && b <= '4') {
      const category: BonusCategory = a === 'F' ? 'flower' : 'season';
      return new BonusTile(category, Number(b) as BonusIndex);
    }
  }
  throw new Error(`Invalid wire tile: ${s}`);
}

// Keep linters happy — Dragon may be referenced in future protocol fields.
void Dragon;

// ---------- Action / Claim (de)serialization ----------

export function actionToWire(a: TurnAction): WireTurnAction {
  switch (a.kind) {
    case 'win':
      return { kind: 'win' };
    case 'discard':
    case 'self-kong':
    case 'add-kong':
      return { kind: a.kind, tile: tileToWire(a.tile) };
  }
}

export function wireToAction(w: WireTurnAction): TurnAction {
  switch (w.kind) {
    case 'win':
      return { kind: 'win' };
    case 'discard':
    case 'self-kong':
    case 'add-kong':
      return { kind: w.kind, tile: wireToTile(w.tile) };
  }
}

export function claimToWire(c: Claim): WireClaim {
  switch (c.kind) {
    case 'pass':
    case 'pong':
    case 'kong':
    case 'win':
      return { kind: c.kind };
    case 'chi':
      return {
        kind: 'chi',
        helpers: [tileToWire(c.helpers[0]), tileToWire(c.helpers[1])],
      };
  }
}

export function wireToClaim(w: WireClaim): Claim {
  switch (w.kind) {
    case 'pass':
    case 'pong':
    case 'kong':
    case 'win':
      return { kind: w.kind };
    case 'chi': {
      const a = wireToTile(w.helpers[0]);
      const b = wireToTile(w.helpers[1]);
      if (!a.isSuit() || !b.isSuit()) {
        throw new Error('Chi wire helpers must be suit tiles');
      }
      return { kind: 'chi', helpers: [a, b] };
    }
  }
}
