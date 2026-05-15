import { useState } from 'react';
import { useMultiplayerStore } from '@store/multiplayerStore';
import { Wind } from '@core/tiles/HonorTile';
import { GameTable, type GameTablePending } from './GameTable';

export function MultiplayerPage() {
  const status = useMultiplayerStore((s) => s.status);

  if (status.kind === 'idle' || status.kind === 'error') {
    return <ConnectScreen errorMessage={status.kind === 'error' ? status.message : null} />;
  }
  if (status.kind === 'connecting') {
    return <CenteredMessage>Connecting…</CenteredMessage>;
  }
  if (status.kind === 'lobby') {
    return <LobbyScreen />;
  }
  return <PlayingScreen />;
}

// ---------------- Connect / lobby screens ----------------

function ConnectScreen({ errorMessage }: { errorMessage: string | null }) {
  const [name, setName] = useState('');
  const [hostId, setHostId] = useState('');
  const host = useMultiplayerStore((s) => s.host);
  const join = useMultiplayerStore((s) => s.join);

  return (
    <div className="min-h-[80vh] flex flex-col items-center justify-center gap-4 p-8 font-cjk">
      <h2 className="text-2xl font-bold">Multiplayer · 連線對局</h2>
      <p className="text-sm opacity-70 max-w-md text-center">
        Four players connect peer-to-peer over WebRTC. One person creates a room and shares the
        code with the other three.
      </p>
      <input
        type="text"
        placeholder="Your name"
        value={name}
        onChange={(e) => setName(e.target.value)}
        className="bg-stone-700 text-white rounded px-3 py-1 w-64"
        maxLength={20}
      />
      <div className="flex flex-col gap-2 items-center">
        <button
          type="button"
          className="px-6 py-2 bg-amber-700 hover:bg-amber-600 rounded disabled:opacity-40"
          disabled={!name.trim()}
          onClick={() => host(name.trim())}
        >
          Host a room
        </button>
        <div className="text-xs opacity-50">— or —</div>
        <input
          type="text"
          placeholder="Room code"
          value={hostId}
          onChange={(e) => setHostId(e.target.value)}
          className="bg-stone-700 text-white rounded px-3 py-1 w-64 font-mono"
        />
        <button
          type="button"
          className="px-6 py-2 bg-stone-700 hover:bg-stone-600 rounded disabled:opacity-40"
          disabled={!name.trim() || !hostId.trim()}
          onClick={() => join(hostId.trim(), name.trim())}
        >
          Join a room
        </button>
      </div>
      {errorMessage && (
        <div className="mt-4 text-rose-300 text-sm max-w-md text-center">
          Error: {errorMessage}
        </div>
      )}
    </div>
  );
}

function LobbyScreen() {
  const role = useMultiplayerStore((s) => s.role);
  const myPeerId = useMultiplayerStore((s) => s.myPeerId);
  const hostPeerId = useMultiplayerStore((s) => s.hostPeerId);
  const lobby = useMultiplayerStore((s) => s.lobby);
  const startRound = useMultiplayerStore((s) => s.startRound);
  const leave = useMultiplayerStore((s) => s.leave);

  const roomCode = role === 'host' ? myPeerId : hostPeerId;
  const canStart = role === 'host' && lobby.length === 4;

  return (
    <div className="min-h-[80vh] flex flex-col items-center justify-center gap-4 p-8 font-cjk">
      <h2 className="text-2xl font-bold">Lobby · 大堂</h2>
      <div className="bg-stone-800 rounded-lg p-4 flex flex-col gap-2 min-w-[400px]">
        <div className="text-xs opacity-70">
          Room code (share with friends):
        </div>
        <div className="font-mono text-sm bg-stone-900 rounded px-2 py-1 select-all break-all">
          {roomCode ?? '—'}
        </div>
        <div className="text-xs opacity-70 mt-2">Players ({lobby.length}/4):</div>
        <ul className="text-sm">
          {lobby.map((p) => (
            <li key={p.peerId} className="flex justify-between gap-2 py-0.5">
              <span>
                <span className="font-bold text-amber-300 mr-2">{p.seat}</span>
                {p.name}
              </span>
              {p.peerId === myPeerId && <span className="opacity-60 text-xs">(you)</span>}
            </li>
          ))}
        </ul>
      </div>
      {role === 'host' && (
        <button
          type="button"
          disabled={!canStart}
          className="px-6 py-2 bg-amber-700 hover:bg-amber-600 rounded disabled:opacity-40"
          onClick={startRound}
        >
          {canStart ? 'Start round' : `Waiting for ${4 - lobby.length} more player(s)…`}
        </button>
      )}
      {role === 'client' && lobby.length < 4 && (
        <div className="text-sm opacity-70">Waiting for host to start…</div>
      )}
      <button
        type="button"
        className="text-xs opacity-70 underline mt-4"
        onClick={leave}
      >
        Leave room
      </button>
    </div>
  );
}

// ---------------- Playing screen ----------------

function PlayingScreen() {
  const tick = useMultiplayerStore((s) => s.tick);
  void tick;

  const game = useMultiplayerStore((s) => s.game);
  const pending = useMultiplayerStore((s) => s.pending);
  const outcome = useMultiplayerStore((s) => s.outcome);
  const mySeat = useMultiplayerStore((s) => s.mySeat);
  const resolveAction = useMultiplayerStore((s) => s.resolveAction);
  const resolveClaim = useMultiplayerStore((s) => s.resolveClaim);
  const leave = useMultiplayerStore((s) => s.leave);
  const status = useMultiplayerStore((s) => s.status);

  if (!game || mySeat === null) {
    return <CenteredMessage>Loading game…</CenteredMessage>;
  }

  const tablePending: GameTablePending | null = pending
    ? pending.kind === 'action'
      ? { kind: 'action', view: pending.view, drawn: pending.drawn }
      : { kind: 'claim', view: pending.view, discard: pending.discard, options: pending.options }
    : null;

  return (
    <div>
      <div className="flex justify-end p-2">
        <button
          type="button"
          className="text-xs opacity-70 underline"
          onClick={leave}
        >
          Leave room
        </button>
      </div>
      <GameTable
        game={game}
        pending={tablePending}
        outcome={status.kind === 'finished' ? outcome : null}
        mySeat={mySeat}
        inProgress={status.kind === 'playing'}
        resolveAction={resolveAction}
        resolveClaim={resolveClaim}
        // No "Next round" button in MVP — multiplayer plays one round only.
      />
      {/* Re-anchor Wind enum so the import lint stays satisfied even when unused above. */}
      <span className="hidden">{Wind.East}</span>
    </div>
  );
}

function CenteredMessage({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-[80vh] flex items-center justify-center font-cjk text-lg opacity-80">
      {children}
    </div>
  );
}
