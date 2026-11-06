// @vitest-environment node
//
// Online play against the real database (project github-games-e7c7d, key
// `mahjong`). Skipped unless FIREBASE_LIVE=1:
//
//   FIREBASE_LIVE=1 npx vitest run src/net/firebase.live.test.ts
//
// Two "devices" (separate Firebase apps, separate anonymous sign-ins) open a
// room, seat themselves, start a match, play part of a hand through MatchSync
// and check they hold the same state — plus the security rules' refusals.
// It prints the room code it used; the room is swept automatically a week
// after its day ends, or remove it with
//   MSYS_NO_PATHCONV=1 npx firebase-tools database:remove /mahjong/rooms/CODE --force

import { describe, expect, it } from 'vitest';
import { chooseAction } from '@/core/ai';
import { checksum, createMatch, pendingSeats, type MatchConfig } from '@/core/engine';
import { DEFAULT_HK_RULES } from '@/core/variants/hk';
import { createFirebaseTransport } from './firebaseRoom';
import type { ChatMessage, LobbyState, Presence, RoomConnection, RoomEvents, StartRecord } from './room';
import { MatchSync } from './sync';

const live = process.env.FIREBASE_LIVE === '1';
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function until(what: string, test: () => boolean, ms = 20000): Promise<void> {
  const end = Date.now() + ms;
  while (!test()) {
    if (Date.now() > end) throw new Error(`timed out waiting for ${what}`);
    await sleep(50);
  }
}

function device() {
  const seen = { lobby: null as LobbyState | null, chat: [] as ChatMessage[], people: [] as Presence[] };
  const events: RoomEvents = {
    lobby: (l) => (seen.lobby = l),
    chat: (m) => seen.chat.push(m),
    presence: (p) => (seen.people = p),
    connected: () => {},
  };
  return { seen, events };
}

describe.skipIf(!live)('Firebase rooms (live)', () => {
  it('two devices play in step and the rules hold', { timeout: 180_000 }, async () => {
    const stamp = Date.now().toString(36).toUpperCase().slice(-4);
    const code = `Z${stamp}`.replace(/[^A-Z0-9]/g, 'Q').slice(0, 5);
    console.log(`live test room: ${code}`);

    const hostT = createFirebaseTransport({ appName: 'live-host', memory: true });
    const guestT = createFirebaseTransport({ appName: 'live-guest', memory: true });
    const host = device();
    const guest = device();

    const lobby: LobbyState = {
      hostUuid: 'host-uuid',
      seats: [{ kind: 'human', uuid: 'host-uuid', name: 'Host' }, { kind: 'open' }, { kind: 'open' }, { kind: 'open' }],
      rulesJson: JSON.stringify(DEFAULT_HK_RULES),
      variant: 'hk',
      match: null,
      matchCount: 0,
    };
    const hostRoom = (await hostT.createRoom(code, { hostUuid: 'host-uuid', createdAt: Date.now(), build: 'live-test' }, lobby, { uuid: 'host-uuid', name: 'Host' }, host.events))!;
    expect(hostRoom).not.toBeNull();

    // A second create over the same code is refused (the room exists).
    const clash = await guestT.createRoom(code, { hostUuid: 'x', createdAt: Date.now(), build: 'x' }, lobby, { uuid: 'x', name: 'x' }, device().events);
    expect(clash).toBeNull();

    expect(await guestT.joinRoom('NOPE9', { uuid: 'guest-uuid', name: 'Guest' }, device().events)).toBeNull();
    const guestRoom = (await guestT.joinRoom(code, { uuid: 'guest-uuid', name: 'Guest' }, guest.events))!;
    expect(guestRoom).not.toBeNull();

    // The guest seats itself by transaction; both devices see it.
    await guestRoom.updateLobby((l) => ({ ...l, seats: [l.seats[0]!, { kind: 'human', uuid: 'guest-uuid', name: 'Guest' }, l.seats[2]!, l.seats[3]!] }));
    await until('the host seeing the guest seated', () => host.seen.lobby?.seats[1]?.kind === 'human');
    await until('presence', () => host.seen.people.length === 2 && guest.seen.people.length === 2);

    // Chat both ways.
    await hostRoom.sendChat({ id: 'c1', byUuid: 'host-uuid', name: 'Host', text: 'hello', ts: Date.now(), kind: 'user' });
    await until('chat', () => guest.seen.chat.some((m) => m.id === 'c1'));

    // Start a match: host fills the AI seats and writes the start record.
    const config: MatchConfig = {
      variant: 'hk',
      rules: DEFAULT_HK_RULES,
      seed: 4242,
      seats: [
        { name: 'Host', ai: false, uuid: 'host-uuid' },
        { name: 'Guest', ai: false, uuid: 'guest-uuid' },
        { name: 'Wong', ai: true, level: 'normal' },
        { name: 'Chan', ai: true, level: 'hard' },
      ],
    };
    const record: StartRecord = { config, hostUuid: 'host-uuid', startedAt: Date.now(), check: checksum(createMatch(config)) };
    // Only the host may write a start record.
    await expect(guestRoom.startMatch(0, record)).rejects.toThrow();
    await hostRoom.updateLobby((l) => ({ ...l, match: 0, matchCount: 1 }));
    await hostRoom.startMatch(0, record);
    await expect(hostRoom.startMatch(0, record)).rejects.toThrow(); // write-once

    const notices: string[] = [];
    const watch = (room: RoomConnection) => {
      const sync = new MatchSync(room, 0, () => {}, (t) => notices.push(t));
      room.watchMatch(0, { start: (r) => sync.onStart(r), action: (seq, e) => sync.onAction(seq, e) });
      return sync;
    };
    const hostSync = watch(hostRoom);
    const guestSync = watch(guestRoom);
    await until('both devices building the opening', () => !!hostSync.base && !!guestSync.base);

    // Play 40 moves: the guest's device answers for seat 1, the host's for everyone else.
    for (let n = 0; n < 40; n++) {
      const v = hostSync.base!;
      if (v.hand.phase === 'end') break;
      const seat = pendingSeats(v)[0]!;
      const sync = seat === 1 ? guestSync : hostSync;
      await until('the deciding device to catch up', () => sync.base!.seq === v.seq);
      expect(sync.submit(chooseAction(sync.base!, seat)!, seat > 1)).toBe(true);
      await until('the move to land on both devices', () => hostSync.base!.seq === v.seq + 1 && guestSync.base!.seq === v.seq + 1);
    }
    expect(JSON.stringify(guestSync.base)).toBe(JSON.stringify(hostSync.base));
    expect(hostSync.base!.seq).toBeGreaterThanOrEqual(30);
    expect(notices).toEqual([]);

    // Log slots are write-once.
    expect(await guestRoom.appendAction(0, 0, { action: { type: 'ready', seat: 1 }, nonce: 'dup' })).toBe(false);

    // A late joiner replays the log to the same state.
    const lateT = createFirebaseTransport({ appName: 'live-late', memory: true });
    const late = device();
    const lateRoom = (await lateT.joinRoom(code, { uuid: 'late-uuid', name: 'Late' }, late.events))!;
    const lateSync = watch(lateRoom);
    await until('the late joiner replaying', () => lateSync.base?.seq === hostSync.base!.seq);
    expect(JSON.stringify(lateSync.base)).toBe(JSON.stringify(hostSync.base));

    lateRoom.leave();
    guestRoom.leave();
    hostRoom.leave();
  });
});
