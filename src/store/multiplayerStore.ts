import { create } from 'zustand';
import { Game } from '@core/game/Game';
import { HumanPlayer } from '@core/players/HumanPlayer';
import { Wind, SEAT_ORDER } from '@core/tiles/HonorTile';
import { mulberry32 } from '@utils/rng';
import { HKOldStyleWinValidator } from '@core/scoring/HKOldStyleWinValidator';
import { DEFAULT_RULES } from '@core/scoring/RulesConfig';
import { Connection, type ConnectionRole } from '@multiplayer/Connection';
import { RemotePolicy } from '@multiplayer/RemotePolicy';
import {
  actionToWire,
  claimToWire,
  seatToWind,
  windToSeat,
  wireToAction,
  wireToClaim,
  type LobbyEntry,
  type RoomMessage,
  type SeatName,
} from '@multiplayer/Protocol';
import type { RoundOutcome, TurnAction, Claim } from '@core/game/types';
import type { SeatedPlayers } from '@core/game/Round';
import { UIPolicy, type ActionRequest, type ClaimRequest } from './UIPolicy';

export type MultiplayerStatus =
  | { kind: 'idle' }
  | { kind: 'connecting' }
  | { kind: 'lobby' }
  | { kind: 'playing' }
  | { kind: 'finished' }
  | { kind: 'error'; message: string };

type PendingDecision =
  | ({ kind: 'action' } & ActionRequest)
  | ({ kind: 'claim' } & ClaimRequest);

interface MultiplayerStore {
  status: MultiplayerStatus;
  role: ConnectionRole | null;
  myPeerId: string | null;
  myName: string;
  mySeat: Wind | null;
  hostPeerId: string | null;
  lobby: LobbyEntry[];

  // Game state (populated when status === 'playing' or 'finished')
  game: Game | null;
  pending: PendingDecision | null;
  outcome: RoundOutcome | null;
  tick: number;

  // Lifecycle
  host: (name: string) => void;
  join: (hostId: string, name: string) => void;
  leave: () => void;
  /** Host-only: broadcast start-round + run locally. Reuses the existing Game (scores persist). */
  startRound: () => void;

  // User-input dispatchers (mirrors gameStore)
  resolveAction: (action: TurnAction) => void;
  resolveClaim: (claim: Claim) => void;
}

// ----- Module-scoped runtime (held outside Zustand state because PeerJS / Promises aren't snapshot-friendly) -----

let connection: Connection | null = null;
let remotePolicies: Map<Wind, RemotePolicy> = new Map();
let uiPolicy: UIPolicy | null = null;
let activeGame: Game | null = null;
/** Shared validator instance — same default rules the Game uses. */
const sharedWinValidator = new HKOldStyleWinValidator(DEFAULT_RULES);

function resetRuntime(): void {
  connection?.destroy();
  connection = null;
  for (const p of remotePolicies.values()) {
    p.abort('multiplayer session ended');
  }
  remotePolicies = new Map();
  uiPolicy = null;
  activeGame = null;
}

function assignSeat(lobby: LobbyEntry[]): SeatName {
  const used = new Set(lobby.map((l) => l.seat));
  for (const s of ['E', 'S', 'W', 'N'] as const) {
    if (!used.has(s)) return s;
  }
  throw new Error('Lobby is full');
}

function isGameDecision(msg: RoomMessage): boolean {
  return msg.type === 'action-decision' || msg.type === 'claim-decision';
}

// ----- Store -----

export const useMultiplayerStore = create<MultiplayerStore>((set, get) => {
  function bumpTick(): void {
    set({ tick: get().tick + 1 });
  }

  function applyDecisionLocally(msg: RoomMessage): void {
    if (msg.type === 'action-decision') {
      const seat = seatToWind(msg.seat);
      if (seat === get().mySeat) return; // our own decision was already applied via UIPolicy
      const policy = remotePolicies.get(seat);
      policy?.receiveAction(wireToAction(msg.action));
      return;
    }
    if (msg.type === 'claim-decision') {
      const seat = seatToWind(msg.seat);
      if (seat === get().mySeat) return;
      const policy = remotePolicies.get(seat);
      policy?.receiveClaim(wireToClaim(msg.claim));
    }
  }

  function buildUIPolicy(): UIPolicy {
    return new UIPolicy(
      {
        onActionRequest: (req) => {
          set({ pending: { kind: 'action', ...req }, tick: get().tick + 1 });
        },
        onClaimRequest: (req) => {
          set({ pending: { kind: 'claim', ...req }, tick: get().tick + 1 });
        },
      },
      sharedWinValidator,
    );
  }

  /** Build players + Game once per multiplayer session. Reused across rounds so scores persist. */
  function ensureGame(mySeat: Wind): Game {
    if (activeGame) return activeGame;
    uiPolicy = buildUIPolicy();
    remotePolicies = new Map();
    const players = SEAT_ORDER.map((wind) => {
      if (wind === mySeat) {
        return new HumanPlayer(get().myName || 'You', wind, uiPolicy!);
      }
      const remote = new RemotePolicy();
      remotePolicies.set(wind, remote);
      const lobby = get().lobby.find((l) => seatToWind(l.seat) === wind);
      return new HumanPlayer(lobby?.name ?? wind, wind, remote);
    }) as unknown as SeatedPlayers;
    activeGame = new Game(players, {
      onTurnEnd: async () => {
        bumpTick();
        await new Promise((r) => setTimeout(r, 250));
      },
    });
    return activeGame;
  }

  async function runRound(seed: number): Promise<void> {
    const mySeat = get().mySeat;
    if (mySeat === null) throw new Error('Cannot begin round without a seat');
    const game = ensureGame(mySeat);
    set({ game, status: { kind: 'playing' }, outcome: null, pending: null });
    try {
      const outcome = await game.playRound(mulberry32(seed));
      set({ outcome, pending: null, status: { kind: 'finished' }, tick: get().tick + 1 });
    } catch (err) {
      const message = (err as Error).message ?? String(err);
      set({ status: { kind: 'error', message }, pending: null });
    }
  }

  function onMessage(msg: RoomMessage, fromPeerId: string): void {
    // Host relays in-game decisions to other clients.
    if (get().role === 'host' && isGameDecision(msg) && connection) {
      for (const peerId of connection.peers) {
        if (peerId !== fromPeerId) connection.send(msg, peerId);
      }
    }

    switch (msg.type) {
      case 'hello': {
        // Host-only: a new client introduced themselves.
        if (get().role !== 'host') return;
        const lobby = get().lobby;
        if (lobby.some((l) => l.peerId === msg.peerId)) return;
        const seat = assignSeat(lobby);
        const next = [...lobby, { peerId: msg.peerId, name: msg.name, seat }];
        set({ lobby: next });
        connection?.send({ type: 'lobby-update', players: next });
        return;
      }
      case 'lobby-update': {
        set({ lobby: msg.players });
        const me = msg.players.find((l) => l.peerId === get().myPeerId);
        if (me) set({ mySeat: seatToWind(me.seat) });
        return;
      }
      case 'start-round': {
        void runRound(msg.seed);
        return;
      }
      case 'action-decision':
      case 'claim-decision':
        applyDecisionLocally(msg);
        return;
      case 'host-left':
        resetRuntime();
        set({ status: { kind: 'error', message: 'Host left the room.' }, lobby: [] });
        return;
    }
  }

  function startConnection(role: ConnectionRole, name: string, hostId?: string): void {
    resetRuntime();
    set({
      status: { kind: 'connecting' },
      role,
      myName: name,
      lobby: [],
      mySeat: role === 'host' ? Wind.East : null,
      hostPeerId: role === 'host' ? null : (hostId ?? null),
      game: null,
      pending: null,
      outcome: null,
    });
    connection = new Connection(
      role,
      {
        onReady: (myPeerId) => {
          set({ myPeerId });
          if (role === 'host') {
            // Seed the lobby with ourselves.
            const me: LobbyEntry = { peerId: myPeerId, name, seat: 'E' };
            set({ lobby: [me], status: { kind: 'lobby' }, hostPeerId: myPeerId });
          }
        },
        onConnect: (peerId) => {
          if (role === 'client') {
            // Send our hello to the host.
            connection?.send({ type: 'hello', peerId: get().myPeerId ?? '', name }, peerId);
            set({ status: { kind: 'lobby' } });
          }
        },
        onMessage,
        onDisconnect: (peerId) => {
          // For MVP: just remove from lobby and abort any pending RemotePolicy.
          set({ lobby: get().lobby.filter((l) => l.peerId !== peerId) });
          for (const p of remotePolicies.values()) p.abort('peer disconnected');
        },
        onError: (message) => {
          set({ status: { kind: 'error', message } });
        },
      },
      hostId,
    );
  }

  return {
    status: { kind: 'idle' },
    role: null,
    myPeerId: null,
    myName: '',
    mySeat: null,
    hostPeerId: null,
    lobby: [],
    game: null,
    pending: null,
    outcome: null,
    tick: 0,

    host: (name) => startConnection('host', name),
    join: (hostId, name) => startConnection('client', name, hostId),
    leave: () => {
      if (get().role === 'host') {
        connection?.send({ type: 'host-left' });
      }
      resetRuntime();
      set({
        status: { kind: 'idle' },
        role: null,
        myPeerId: null,
        mySeat: null,
        hostPeerId: null,
        lobby: [],
        game: null,
        pending: null,
        outcome: null,
      });
    },

    startRound: () => {
      if (get().role !== 'host') return;
      if (get().lobby.length < 4) return;
      const seed = (Math.random() * 0xffffffff) >>> 0;
      const dealerWind = activeGame?.dealer ?? Wind.East;
      connection?.send({ type: 'start-round', seed, dealer: windToSeat(dealerWind) });
      void runRound(seed);
    },

    resolveAction: (action) => {
      const p = get().pending;
      if (p?.kind !== 'action') return;
      set({ pending: null });
      p.resolve(action);
      const mySeat = get().mySeat;
      if (mySeat !== null) {
        connection?.send({
          type: 'action-decision',
          seat: windToSeat(mySeat),
          action: actionToWire(action),
        });
      }
    },

    resolveClaim: (claim) => {
      const p = get().pending;
      if (p?.kind !== 'claim') return;
      set({ pending: null });
      p.resolve(claim);
      const mySeat = get().mySeat;
      if (mySeat !== null) {
        connection?.send({
          type: 'claim-decision',
          seat: windToSeat(mySeat),
          claim: claimToWire(claim),
        });
      }
    },
  };
});
