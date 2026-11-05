// The real RoomTransport: Firebase Realtime Database in the shared project
// github-games-e7c7d (also used by Catan, Card Collecting, Tractor, …).
// Loaded lazily (dynamic import from netStore), so solo play never downloads
// the SDK or opens a connection.
//
// Everything this app stores lives under one top-level key, DB_ROOT
// ("mahjong"); database.rules.json defines only that key and
// scripts/merge-db-rules.mjs merges it into the live rules on deploy, leaving
// the other apps' rules alone. Paths below are relative to DB_ROOT:
//
//   rooms/{CODE}/meta                 { hostUuid, hostUid, createdAt, build, v }   written once
//   rooms/{CODE}/lobby                JSON string of LobbyState                   edited by transaction
//   rooms/{CODE}/matches/m{N}/start   JSON string of StartRecord                  written once, by the host
//   rooms/{CODE}/matches/m{N}/actions/aNNNNNN   JSON {a, n}                       write-once log slots
//   rooms/{CODE}/chat/{pushId}        JSON string of ChatMessage
//   rooms/{CODE}/presence/{pushId}    { uid, uuid, name }                         removed by onDisconnect
//   roomDays/{day} → when that UTC day ends; roomIndex/{day}/{CODE} → true      (stale-room sweep)
//
// Devices sign in anonymously and silently; the uid only lets the rules tie
// writes to a device. Payloads are JSON strings because the database drops
// empty arrays and turns arrays into keyed objects.

import { getApps, initializeApp, type FirebaseApp } from 'firebase/app';
import {
  browserLocalPersistence,
  browserSessionPersistence,
  getAuth,
  indexedDBLocalPersistence,
  initializeAuth,
  signInAnonymously,
  type Auth,
} from 'firebase/auth';
import {
  get,
  getDatabase,
  goOffline,
  goOnline,
  limitToFirst,
  onChildAdded,
  onDisconnect,
  onValue,
  orderByValue,
  push,
  query,
  ref,
  remove,
  runTransaction,
  serverTimestamp,
  set,
  update,
  type Database,
  type DatabaseReference,
  type DataSnapshot,
  type Unsubscribe,
} from 'firebase/database';
import {
  DAY_MS,
  ROOM_LIFETIME_MS,
  SWEEP_DAYS,
  ServerUnreachableError,
  decodeAction,
  encodeAction,
  freshTabMode,
  matchKey,
  parseJson,
  parseSeqKey,
  seqKey,
  type ChatMessage,
  type LobbyState,
  type Presence,
  type RoomConnection,
  type RoomEvents,
  type RoomMeta,
  type RoomTransport,
  type StartRecord,
} from './room';

// Public by design: a web app's config identifies the project; access is
// decided by the security rules. (The "Mahjong" web app in the project.)
export const FIREBASE_CONFIG = {
  apiKey: 'AIzaSyAmAirzwcz926PyKh-bfUUIn7OSkcve6tI',
  authDomain: 'github-games-e7c7d.firebaseapp.com',
  databaseURL: 'https://github-games-e7c7d-default-rtdb.firebaseio.com',
  projectId: 'github-games-e7c7d',
  appId: '1:879254296864:web:ed180b1b70fb39eb8f1f45',
};

/** This app's top-level key in the shared database (must match database.rules.json). */
export const DB_ROOT = 'mahjong';
/** Bump with the room layout (the rules check it too). */
export const PROTOCOL_VERSION = 1;
const SERVER_TIMEOUT_MS = 15000;

function serverTimeOffset(db: Database): Promise<number> {
  return new Promise((resolve) => {
    onValue(ref(db, '.info/serverTimeOffset'), (s) => resolve(Number(s.val()) || 0), { onlyOnce: true });
  });
}

/** Delete rooms nobody is in from days that ended over a week ago, then the emptied days. */
async function sweepStaleRooms(db: Database): Promise<void> {
  const cutoff = Date.now() + (await serverTimeOffset(db)) - ROOM_LIFETIME_MS - 60_000;
  const days = await get(query(ref(db, `${DB_ROOT}/roomDays`), orderByValue(), limitToFirst(SWEEP_DAYS)));
  const stale: string[] = [];
  days.forEach((d) => {
    if (d.key && Number(d.val()) <= cutoff) stale.push(d.key);
  });
  for (const day of stale) {
    const codes: string[] = [];
    (await get(ref(db, `${DB_ROOT}/roomIndex/${day}`))).forEach((c) => {
      if (c.key) codes.push(c.key);
    });
    let kept = 0;
    await Promise.all(
      codes.map((code) =>
        update(ref(db, DB_ROOT), { [`rooms/${code}`]: null, [`roomIndex/${day}/${code}`]: null }).catch(() => kept++),
      ),
    );
    if (kept === 0) await remove(ref(db, `${DB_ROOT}/roomDays/${day}`)).catch(() => {});
  }
}

function withTimeout<T>(p: Promise<T>, what: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new ServerUnreachableError(`Timed out ${what}.`)), SERVER_TIMEOUT_MS);
    p.then(
      (v) => {
        clearTimeout(t);
        resolve(v);
      },
      (e: unknown) => {
        clearTimeout(t);
        reject(e);
      },
    );
  });
}

const errorText = (e: unknown) => {
  const err = e as { code?: string; message?: string };
  return `${err.code ?? ''} ${err.message ?? String(e)}`;
};
const isPermissionDenied = (e: unknown) => /permission.denied/i.test(errorText(e));
const unreachable = (e: unknown) =>
  e instanceof ServerUnreachableError ? e : new ServerUnreachableError(`Could not reach the game server (${errorText(e).trim()}).`);

export function createFirebaseTransport(): RoomTransport {
  let client: { app: FirebaseApp; auth: Auth; db: Database } | null = null;
  let signIn: Promise<string> | null = null;
  let openRooms = 0;
  let online = true;

  function firebase() {
    if (client) return client;
    const app = getApps()[0] ?? initializeApp(FIREBASE_CONFIG);
    let auth: Auth;
    try {
      auth = initializeAuth(app, {
        persistence: freshTabMode() ? browserSessionPersistence : [indexedDBLocalPersistence, browserLocalPersistence],
      });
    } catch {
      auth = getAuth(app); // already initialised (hot reload)
    }
    client = { app, auth, db: getDatabase(app) };
    return client;
  }

  function connect(): Database {
    const { db } = firebase();
    if (!online) {
      goOnline(db);
      online = true;
    }
    return db;
  }

  function disconnectIfIdle(): void {
    if (openRooms > 0 || !online || !client) return;
    goOffline(client.db);
    online = false;
  }

  function uid(): Promise<string> {
    signIn ??= withTimeout(
      (async () => {
        const { auth } = firebase();
        await auth.authStateReady();
        return (auth.currentUser ?? (await signInAnonymously(auth)).user).uid;
      })(),
      'signing in',
    ).catch((e: unknown) => {
      signIn = null;
      throw unreachable(e);
    });
    return signIn;
  }

  function openRoom(code: string, meta: RoomMeta, myUid: string, me: Presence, events: RoomEvents): RoomConnection {
    const db = connect();
    openRooms++;
    const base = `${DB_ROOT}/rooms/${code}`;
    const offs: Unsubscribe[] = [];
    let presenceRef: DatabaseReference | null = null;
    let closed = false;
    const cancelled = (what: string) => (e: Error) => console.warn(`[net] ${what} listener stopped:`, e.message);

    offs.push(
      onValue(
        ref(db, `${base}/lobby`),
        (s) => {
          const lobby = parseJson<LobbyState>(s.val());
          if (lobby && !closed) events.lobby(lobby);
        },
        cancelled('lobby'),
      ),
      onChildAdded(
        ref(db, `${base}/chat`),
        (s) => {
          const msg = parseJson<ChatMessage>(s.val());
          if (msg && !closed) events.chat(msg);
        },
        cancelled('chat'),
      ),
      onValue(
        ref(db, `${base}/presence`),
        (s) => {
          const people: Presence[] = [];
          s.forEach((c: DataSnapshot) => {
            const v = c.val() as { uuid?: unknown; name?: unknown } | null;
            if (v && typeof v.uuid === 'string') people.push({ uuid: v.uuid, name: String(v.name ?? '') });
          });
          if (!closed) events.presence(people);
        },
        cancelled('presence'),
      ),
      onValue(ref(db, '.info/connected'), (s) => {
        const up = s.val() === true;
        if (closed) return;
        events.connected(up);
        if (!up) return;
        const p = push(ref(db, `${base}/presence`));
        presenceRef = p;
        onDisconnect(p)
          .remove()
          .then(() => {
            if (!closed && presenceRef === p) return set(p, { uid: myUid, uuid: me.uuid, name: me.name });
          })
          .catch((e: Error) => console.warn('[net] presence failed:', e.message));
      }),
    );

    return {
      code,
      meta,
      updateLobby: async (edit) => {
        let result: LobbyState | null = null;
        const res = await runTransaction(ref(db, `${base}/lobby`), (current: unknown) => {
          result = null;
          if (current === null) return null; // not cached yet: the server answers and this re-runs
          const lobby = parseJson<LobbyState>(current);
          if (!lobby) return undefined;
          result = edit(lobby);
          return result ? JSON.stringify(result) : undefined;
        });
        return res.committed ? result : null;
      },
      watchMatch: (match, matchEvents) => {
        const at = `${base}/matches/${matchKey(match)}`;
        let stopped = false;
        const stops = [
          onValue(
            ref(db, `${at}/start`),
            (s) => {
              const start = parseJson<StartRecord>(s.val());
              if (start && !stopped && !closed) matchEvents.start(start);
            },
            cancelled('start'),
          ),
          onChildAdded(
            ref(db, `${at}/actions`),
            (s) => {
              const seq = parseSeqKey(s.key ?? '');
              const entry = decodeAction(s.val());
              if (seq !== null && entry && !stopped && !closed) matchEvents.action(seq, entry);
            },
            cancelled('actions'),
          ),
        ];
        const stop = () => {
          if (stopped) return;
          stopped = true;
          stops.forEach((off) => off());
        };
        offs.push(stop);
        return stop;
      },
      startMatch: async (match, record) => {
        await set(ref(db, `${base}/matches/${matchKey(match)}/start`), JSON.stringify(record));
      },
      appendAction: async (match, seq, entry) => {
        const value = encodeAction(entry);
        const res = await runTransaction(
          ref(db, `${base}/matches/${matchKey(match)}/actions/${seqKey(seq)}`),
          (current: unknown) => (current === null ? value : undefined),
          // The log listener is how every device, the author included, learns the order.
          { applyLocally: false },
        );
        return res.committed;
      },
      sendChat: async (msg) => {
        await push(ref(db, `${base}/chat`), JSON.stringify(msg));
      },
      leave: () => {
        if (closed) return;
        closed = true;
        offs.forEach((off) => off());
        const p = presenceRef;
        presenceRef = null;
        openRooms--;
        if (openRooms > 0 && p) {
          onDisconnect(p).cancel().catch(() => {});
          remove(p).catch(() => {});
        }
        disconnectIfIdle();
      },
    };
  }

  return {
    warmUp: () => {
      uid().catch(() => {});
    },
    createRoom: async (code, meta, lobby, me, events) => {
      const myUid = await uid();
      const db = connect();
      const serverNow = Date.now() + (await serverTimeOffset(db));
      const day = Math.floor(serverNow / DAY_MS);
      try {
        await withTimeout(
          update(ref(db, DB_ROOT), {
            [`rooms/${code}`]: {
              meta: { hostUuid: meta.hostUuid, hostUid: myUid, createdAt: serverTimestamp(), build: meta.build, v: PROTOCOL_VERSION },
              lobby: JSON.stringify(lobby),
            },
            [`roomIndex/${day}/${code}`]: true,
            [`roomDays/${day}`]: (day + 1) * DAY_MS,
          }),
          'creating the room',
        );
      } catch (e) {
        disconnectIfIdle();
        if (isPermissionDenied(e)) return null; // the code is taken
        throw unreachable(e);
      }
      const room = openRoom(code, meta, myUid, me, events);
      sweepStaleRooms(db).catch((e: Error) => console.warn('[net] stale-room sweep failed:', e.message));
      return room;
    },
    joinRoom: async (code, me, events) => {
      const myUid = await uid();
      const db = connect();
      let snap: DataSnapshot;
      try {
        snap = await withTimeout(get(ref(db, `${DB_ROOT}/rooms/${code}/meta`)), 'looking up the room');
      } catch (e) {
        disconnectIfIdle();
        throw unreachable(e);
      }
      const v = snap.val() as Partial<RoomMeta> | null;
      if (!v || typeof v.hostUuid !== 'string') {
        disconnectIfIdle();
        return null;
      }
      const meta: RoomMeta = {
        hostUuid: v.hostUuid,
        createdAt: typeof v.createdAt === 'number' ? v.createdAt : 0,
        build: typeof v.build === 'string' ? v.build : 'unknown',
      };
      return openRoom(code, meta, myUid, me, events);
    },
  };
}

let transport: RoomTransport | null = null;
export function getTransport(): RoomTransport {
  return (transport ??= createFirebaseTransport());
}
