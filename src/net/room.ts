// Online rooms: what a room stores, the transport interface the store talks
// to, and the small identity / room-code / invite-link helpers. Nothing here
// knows about Firebase (firebaseRoom.ts implements the transport, loaded
// lazily) or about React.
//
// Model (ported from the card-collecting project): the room holds a lobby
// (edited by transaction), and per match a write-once start record and a
// write-once action log. Every device builds the opening from the start record
// with the pure engine and applies the log in slot order, so all devices hold
// the same state; there is no server logic beyond the security rules.

import type { AiLevel, MatchConfig } from '@/core/engine';
import type { VariantId } from '@/core/variants';

export type LobbySeat =
  | { kind: 'open' }
  | { kind: 'human'; uuid: string; name: string }
  | { kind: 'ai'; level: AiLevel; name: string };

export interface LobbyState {
  hostUuid: string;
  seats: LobbySeat[];
  /** The variant's house rules as JSON. */
  rulesJson: string;
  variant: VariantId;
  /** The match being played (its slot under matches/), null while in the lobby. */
  match: number | null;
  /** Matches started so far = the next match's slot. */
  matchCount: number;
}

export interface RoomMeta {
  hostUuid: string;
  createdAt: number;
  build: string;
}

/** How a match began: the engine's inputs, not its state (every device builds the same opening). */
export interface StartRecord {
  config: MatchConfig;
  hostUuid: string;
  startedAt: number;
  /** Checksum of the opening state, so a device on another build can tell it differs. */
  check: string;
}

export interface LoggedAction {
  action: unknown;
  /** Short random id, so the author recognises its own move in the log. */
  nonce: string;
}

export interface ChatMessage {
  id: string;
  byUuid: string;
  name: string;
  text: string;
  ts: number;
  kind: 'user' | 'system';
}

export interface Presence {
  uuid: string;
  name: string;
}

export interface RoomEvents {
  lobby: (lobby: LobbyState) => void;
  chat: (msg: ChatMessage) => void;
  presence: (people: Presence[]) => void;
  connected: (up: boolean) => void;
}

export interface MatchEvents {
  start: (start: StartRecord) => void;
  action: (seq: number, entry: LoggedAction) => void;
}

export interface RoomConnection {
  readonly code: string;
  readonly meta: RoomMeta;
  /** Atomic lobby edit; `edit` may re-run. Resolves with the committed lobby, or null when declined. */
  updateLobby: (edit: (current: LobbyState) => LobbyState | null) => Promise<LobbyState | null>;
  watchMatch: (match: number, events: MatchEvents) => () => void;
  startMatch: (match: number, record: StartRecord) => Promise<void>;
  /** Claim log slot `seq`: true once the server holds it, false when another move took it first. */
  appendAction: (match: number, seq: number, entry: LoggedAction) => Promise<boolean>;
  sendChat: (msg: ChatMessage) => Promise<void>;
  leave: () => void;
}

export interface RoomTransport {
  /** Open a new room; null when the code is taken. */
  createRoom: (code: string, meta: RoomMeta, lobby: LobbyState, me: Presence, events: RoomEvents) => Promise<RoomConnection | null>;
  /** Join a room; null when there's no such room. */
  joinRoom: (code: string, me: Presence, events: RoomEvents) => Promise<RoomConnection | null>;
  warmUp?: () => void;
}

export class ServerUnreachableError extends Error {
  constructor(message = 'Could not reach the game server.') {
    super(message);
    this.name = 'ServerUnreachableError';
  }
}

export const DAY_MS = 24 * 60 * 60 * 1000;
/** Rooms are deleted a week after their (UTC) day ends (database.rules.json uses the same number). */
export const ROOM_LIFETIME_MS = 7 * DAY_MS;
export const SWEEP_DAYS = 5;

export const matchKey = (match: number) => `m${match}`;
export const seqKey = (seq: number) => `a${String(seq).padStart(6, '0')}`;
export const parseSeqKey = (key: string) => (/^a\d{6}$/.test(key) ? Number(key.slice(1)) : null);

export function encodeAction(entry: LoggedAction): string {
  return JSON.stringify({ a: entry.action, n: entry.nonce });
}

export function decodeAction(value: unknown): LoggedAction | null {
  if (typeof value !== 'string') return null;
  try {
    const v = JSON.parse(value) as { a?: unknown; n?: unknown };
    return v.a === undefined || typeof v.n !== 'string' ? null : { action: v.a, nonce: v.n };
  } catch {
    return null;
  }
}

export function parseJson<T>(json: unknown): T | null {
  if (typeof json !== 'string') return null;
  try {
    return JSON.parse(json) as T;
  } catch {
    return null;
  }
}

export const nonce = () => Math.random().toString(36).slice(2, 10);

// ------------------------------------------------------------ identity

const UUID_KEY = 'mahjong.uuid';
const NAME_KEY = 'mahjong.name';

/** `?fresh` keeps identity per tab (two windows of one browser = two players). */
export function freshTabMode(): boolean {
  try {
    return typeof window !== 'undefined' && new URLSearchParams(window.location.search).has('fresh');
  } catch {
    return false;
  }
}

export function getOrCreateUuid(): string {
  try {
    const store = freshTabMode() ? sessionStorage : localStorage;
    const existing = store.getItem(UUID_KEY);
    if (existing) return existing;
    const next = crypto.randomUUID ? crypto.randomUUID() : `${nonce()}-${nonce()}-${nonce()}`;
    store.setItem(UUID_KEY, next);
    return next;
  } catch {
    return `${nonce()}-${nonce()}`;
  }
}

export function savedName(): string {
  try {
    return localStorage.getItem(NAME_KEY) ?? '';
  } catch {
    return '';
  }
}

export function saveName(name: string): void {
  try {
    localStorage.setItem(NAME_KEY, name);
  } catch {
    /* storage unavailable */
  }
}

/** 4 characters, A–Z and 2–9 without look-alikes. */
export function generateRoomCode(): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 4; i++) code += alphabet[Math.floor(Math.random() * alphabet.length)];
  return code;
}

export const normalizeRoomCode = (code: string) => code.trim().toUpperCase().replace(/[^A-Z0-9]/g, '');

export function roomCodeFromUrl(): string | null {
  try {
    const code = new URLSearchParams(window.location.search).get('room');
    const clean = code ? normalizeRoomCode(code) : '';
    return clean.length >= 4 ? clean : null;
  } catch {
    return null;
  }
}

export function setRoomCodeInUrl(code: string | null): void {
  try {
    const url = new URL(window.location.href);
    if (code) url.searchParams.set('room', code);
    else url.searchParams.delete('room');
    const href = url.toString().replace(/([?&]fresh)=(?=&|$)/, '$1');
    if (href !== window.location.href) window.history.replaceState(window.history.state, '', href);
  } catch {
    /* not in a browser */
  }
}

export function roomLink(code: string): string {
  const url = new URL(window.location.origin + window.location.pathname);
  url.searchParams.set('room', code);
  return url.toString();
}
