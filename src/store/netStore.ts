// Online rooms: connection, lobby, presence, chat, and the live match (kept in
// step by MatchSync and shown through gameStore). The Firebase transport is
// imported lazily, so solo play never loads the SDK.
//
// Roles: the host made the room and edits it (seats, rules, start); guests
// seat themselves while the lobby is open; anyone else watches. AI seats are
// driven by one device: the host while it's connected, else the first
// connected human seat (a stand-in) — every device derives the same answer
// from presence, and a duplicate AI move during a hand-off is dropped by the
// log quietly.

import { create } from 'zustand';
import { checksum, createMatch, type Action, type AiLevel, type MatchConfig } from '@/core/engine';
import { freshSeed } from '@/core/rng';
import { defaultRulesFor, normalizeRulesFor, type AnyRules, type VariantId } from '@/core/variants';
import {
  generateRoomCode,
  getOrCreateUuid,
  nonce,
  saveName,
  setRoomCodeInUrl,
  ServerUnreachableError,
  type ChatMessage,
  type LobbySeat,
  type LobbyState,
  type Presence,
  type RoomConnection,
  type RoomEvents,
  type RoomTransport,
} from '@/net/room';
import { MatchSync } from '@/net/sync';
import { AI_NAMES, setSubmitHook, useGame } from './gameStore';

declare const __APP_BUILD__: string;

export type NetStatus = 'idle' | 'connecting' | 'room' | 'error';

interface NetStore {
  status: NetStatus;
  error: string | null;
  code: string | null;
  lobby: LobbyState | null;
  people: Presence[];
  connected: boolean;
  chat: ChatMessage[];
  uuid: string;
  name: string;
  createRoom: (name: string, variant: VariantId, rules?: AnyRules) => Promise<void>;
  joinRoom: (code: string, name: string) => Promise<void>;
  leaveRoom: () => void;
  setSeat: (index: number, seat: LobbySeat) => Promise<void>;
  takeSeat: (index: number) => Promise<void>;
  fillWithAi: () => Promise<void>;
  setRules: (rules: AnyRules) => Promise<void>;
  setVariant: (variant: VariantId) => Promise<void>;
  startMatch: () => Promise<void>;
  backToLobby: () => Promise<void>;
  sendChat: (text: string) => void;
  warmUp: () => void;
}

let transportOverride: RoomTransport | null = null;
/** Tests: use an in-memory transport instead of Firebase. */
export function setTransportForTests(t: RoomTransport | null): void {
  transportOverride = t;
}
async function transport(): Promise<RoomTransport> {
  if (transportOverride) return transportOverride;
  const mod = await import('@/net/firebaseRoom');
  return mod.getTransport();
}

let room: RoomConnection | null = null;
let sync: MatchSync | null = null;
let stopWatching: (() => void) | null = null;
let watching: number | null = null;
let lastPeople = new Set<string>();

const BUILD = typeof __APP_BUILD__ === 'string' ? __APP_BUILD__ : 'dev';

export const useNet = create<NetStore>((set, get) => {
  const system = (text: string) =>
    set((s) => ({ chat: [...s.chat, { id: nonce(), byUuid: '', name: '', text, ts: Date.now(), kind: 'system' }] }));

  /** Push the match view (and who drives the AI) to gameStore. */
  function publish(): void {
    const { lobby, people, uuid } = get();
    const view = sync?.view() ?? null;
    const config = sync?.start?.config;
    if (!lobby || lobby.match === null || !view || !config) {
      useGame.getState().showOnline(null, null, false);
      return;
    }
    const mySeat = config.seats.findIndex((s) => s.uuid === uuid);
    const online = new Set(people.map((p) => p.uuid));
    const driver = online.has(lobby.hostUuid)
      ? lobby.hostUuid
      : (config.seats.find((s) => !s.ai && s.uuid && online.has(s.uuid))?.uuid ?? lobby.hostUuid);
    useGame.getState().showOnline(view, mySeat >= 0 ? mySeat : null, driver === uuid);
  }

  function follow(lobby: LobbyState): void {
    if (lobby.match === watching) return;
    stopWatching?.();
    sync?.stop();
    stopWatching = null;
    sync = null;
    watching = lobby.match;
    if (lobby.match === null || !room) return publish();
    // Every device notes the start itself (system lines aren't sent).
    if (lastPeople.size > 0) system('The match has started.');
    const s = new MatchSync(room, lobby.match, publish, (text) => {
      useGame.getState().setNotice(text);
      system(text);
    });
    sync = s;
    stopWatching = room.watchMatch(lobby.match, {
      start: (record) => s.onStart(record),
      action: (seq, entry) => s.onAction(seq, entry),
    });
  }

  const events: RoomEvents = {
    lobby: (lobby) => {
      set({ lobby });
      follow(lobby);
      publish();
    },
    chat: (msg) => set((s) => (s.chat.some((m) => m.id === msg.id) ? s : { chat: [...s.chat, msg] })),
    presence: (people) => {
      const now = new Set(people.map((p) => p.uuid));
      if (lastPeople.size > 0) {
        for (const p of people) if (!lastPeople.has(p.uuid)) system(`${p.name || 'Someone'} joined.`);
        for (const u of lastPeople) if (!now.has(u)) system(`${nameOf(get().lobby, u)} left.`);
      }
      lastPeople = now;
      set({ people });
      publish();
    },
    connected: (up) => set({ connected: up }),
  };

  async function edit(fn: (l: LobbyState) => LobbyState | null): Promise<LobbyState | null> {
    if (!room) return null;
    const next = await room.updateLobby(fn);
    if (next) {
      set({ lobby: next });
      follow(next);
      publish();
    }
    return next;
  }

  const isHost = () => get().lobby?.hostUuid === get().uuid;

  setSubmitHook((action: Action) => {
    if (!sync) return false;
    const view = sync.view();
    const quiet = !!view && view.config.seats[action.seat]?.ai === true;
    return sync.submit(action, quiet);
  });

  function reset(): void {
    stopWatching?.();
    sync?.stop();
    room?.leave();
    room = null;
    sync = null;
    stopWatching = null;
    watching = null;
    lastPeople = new Set();
    setRoomCodeInUrl(null);
    useGame.getState().showOnline(null, null, false);
  }

  return {
    status: 'idle',
    error: null,
    code: null,
    lobby: null,
    people: [],
    connected: true,
    chat: [],
    uuid: getOrCreateUuid(),
    name: '',

    warmUp: () => {
      void transport().then((t) => t.warmUp?.());
    },

    createRoom: async (name, variant, rules) => {
      reset();
      saveName(name);
      const { uuid } = get();
      set({ status: 'connecting', error: null, name, chat: [] });
      const lobby: LobbyState = {
        hostUuid: uuid,
        seats: [{ kind: 'human', uuid, name }, { kind: 'open' }, { kind: 'open' }, { kind: 'open' }],
        rulesJson: JSON.stringify(rules ?? defaultRulesFor(variant)),
        variant,
        match: null,
        matchCount: 0,
      };
      try {
        const t = await transport();
        for (let attempt = 0; attempt < 6 && !room; attempt++) {
          const code = generateRoomCode();
          room = await t.createRoom(code, { hostUuid: uuid, createdAt: Date.now(), build: BUILD }, lobby, { uuid, name }, events);
        }
        if (!room) throw new Error('Could not find a free room code — try again.');
        set({ status: 'room', code: room.code, lobby });
        setRoomCodeInUrl(room.code);
      } catch (e) {
        set({ status: 'error', error: messageOf(e) });
      }
    },

    joinRoom: async (rawCode, name) => {
      reset();
      saveName(name);
      const code = rawCode.trim().toUpperCase();
      const { uuid } = get();
      set({ status: 'connecting', error: null, name, chat: [], code });
      try {
        const t = await transport();
        room = await t.joinRoom(code, { uuid, name }, events);
        if (!room) {
          set({ status: 'error', error: `There's no room with the code ${code}.` });
          return;
        }
        set({ status: 'room', code });
        setRoomCodeInUrl(code);
        if (room.meta.build !== BUILD && BUILD !== 'dev') system('This room was made on a different version of the app — reload if moves look out of step.');
        await edit((l) => {
          const mine = l.seats.findIndex((s) => s.kind === 'human' && s.uuid === uuid);
          if (mine >= 0) {
            const seats = [...l.seats];
            seats[mine] = { kind: 'human', uuid, name };
            return { ...l, seats };
          }
          const open = l.seats.findIndex((s) => s.kind === 'open');
          if (open < 0 || l.match !== null) return null; // watch instead
          const seats = [...l.seats];
          seats[open] = { kind: 'human', uuid, name };
          return { ...l, seats };
        });
      } catch (e) {
        set({ status: 'error', error: messageOf(e) });
      }
    },

    leaveRoom: () => {
      const { uuid, lobby } = get();
      if (room && lobby && lobby.match === null && lobby.hostUuid !== uuid) {
        void room.updateLobby((l) => {
          const i = l.seats.findIndex((s) => s.kind === 'human' && s.uuid === uuid);
          if (i < 0) return null;
          const seats = [...l.seats];
          seats[i] = { kind: 'open' };
          return { ...l, seats };
        });
      }
      reset();
      set({ status: 'idle', code: null, lobby: null, people: [], chat: [], error: null });
    },

    setSeat: async (index, seat) => {
      if (!isHost()) return;
      await edit((l) => {
        if (l.match !== null) return null;
        const seats = [...l.seats];
        seats[index] = seat;
        return { ...l, seats };
      });
    },

    takeSeat: async (index) => {
      const { uuid, name } = get();
      await edit((l) => {
        if (l.match !== null || l.seats[index]?.kind !== 'open') return null;
        const seats = l.seats.map((s) => (s.kind === 'human' && s.uuid === uuid ? ({ kind: 'open' } as LobbySeat) : s));
        seats[index] = { kind: 'human', uuid, name };
        return { ...l, seats };
      });
    },

    fillWithAi: async () => {
      if (!isHost()) return;
      await edit((l) => {
        const used = new Set(l.seats.flatMap((s) => (s.kind === 'ai' ? [s.name] : [])));
        const free = AI_NAMES.filter((n) => !used.has(n));
        const seats = l.seats.map((s) => (s.kind === 'open' ? ({ kind: 'ai', level: 'normal' as AiLevel, name: free.shift() ?? 'Bot' } as LobbySeat) : s));
        return { ...l, seats };
      });
    },

    setRules: async (rules) => {
      if (!isHost()) return;
      await edit((l) => (l.match !== null ? null : { ...l, rulesJson: JSON.stringify(rules) }));
    },

    setVariant: async (variant) => {
      if (!isHost()) return;
      await edit((l) => (l.match !== null || l.variant === variant ? null : { ...l, variant, rulesJson: JSON.stringify(defaultRulesFor(variant)) }));
    },

    startMatch: async () => {
      const { lobby, uuid } = get();
      if (!room || !lobby || !isHost()) return;
      if (lobby.seats.some((s) => s.kind === 'open')) return;
      const config: MatchConfig = {
        variant: lobby.variant,
        rules: normalizeRulesFor(lobby.variant, JSON.parse(lobby.rulesJson)),
        seed: freshSeed(),
        seats: lobby.seats.map((s) =>
          s.kind === 'human' ? { name: s.name, ai: false, uuid: s.uuid } : s.kind === 'ai' ? { name: s.name, ai: true, level: s.level } : { name: '?', ai: true },
        ),
      };
      const record = { config, hostUuid: uuid, startedAt: Date.now(), check: checksum(createMatch(config)) };
      const next = await edit((l) => (l.match !== null ? null : { ...l, match: l.matchCount, matchCount: l.matchCount + 1 }));
      if (next?.match != null) await room.startMatch(next.match, record);
    },

    backToLobby: async () => {
      if (!isHost()) return;
      await edit((l) => ({ ...l, match: null }));
    },

    sendChat: (text) => {
      const t = text.trim().slice(0, 300);
      if (!t || !room) return;
      const { uuid, name } = get();
      const msg: ChatMessage = { id: nonce(), byUuid: uuid, name, text: t, ts: Date.now(), kind: 'user' };
      set((s) => ({ chat: [...s.chat, msg] }));
      room.sendChat(msg).catch(() => system("Couldn't send that message."));
    },
  };
});

function nameOf(lobby: LobbyState | null, uuid: string): string {
  const seat = lobby?.seats.find((s) => s.kind === 'human' && s.uuid === uuid);
  return seat && seat.kind === 'human' ? seat.name : 'Someone';
}

function messageOf(e: unknown): string {
  if (e instanceof ServerUnreachableError) return "Couldn't reach the game server. Check your connection and try again.";
  return e instanceof Error ? e.message : String(e);
}
