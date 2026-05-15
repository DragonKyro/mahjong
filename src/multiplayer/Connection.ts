import Peer from 'peerjs';
import type { DataConnection } from 'peerjs';
import type { RoomMessage } from './Protocol';

export type ConnectionRole = 'host' | 'client';

export interface ConnectionEvents {
  /** Fired once when this peer is registered with the PeerJS broker. */
  onReady: (myPeerId: string) => void;
  /** Fired when a data channel opens (peer-to-peer link is live). */
  onConnect: (peerId: string) => void;
  onMessage: (msg: RoomMessage, fromPeerId: string) => void;
  onDisconnect: (peerId: string) => void;
  onError: (err: string) => void;
}

/**
 * Thin PeerJS wrapper. Two modes:
 *
 *  - **host**: creates a peer with an auto-generated ID, then listens for
 *    incoming `peer.connect()` calls. The peer ID is the room code.
 *  - **client**: creates a peer, then dials the given host ID exactly once.
 *
 * The class is intentionally low-level — it doesn't relay messages or know
 * about the lobby. `multiplayerStore` does the relaying and game logic.
 */
export class Connection {
  readonly role: ConnectionRole;
  private readonly peer: Peer;
  private readonly events: ConnectionEvents;
  private readonly connections = new Map<string, DataConnection>();
  private myPeerId: string | null = null;

  constructor(role: ConnectionRole, events: ConnectionEvents, hostId?: string) {
    this.role = role;
    this.events = events;
    this.peer = new Peer();

    this.peer.on('open', (id) => {
      this.myPeerId = id;
      events.onReady(id);
      if (role === 'client') {
        if (!hostId) {
          events.onError('Client mode requires a host peer ID');
          return;
        }
        const conn = this.peer.connect(hostId, { reliable: true });
        this.attachConnection(conn);
      }
    });

    if (role === 'host') {
      this.peer.on('connection', (conn) => this.attachConnection(conn));
    }

    this.peer.on('error', (err) => {
      const message = (err as Error).message ?? String(err);
      events.onError(message);
    });
  }

  get peerId(): string | null {
    return this.myPeerId;
  }

  /** Connected peer IDs (excluding self). */
  get peers(): string[] {
    return Array.from(this.connections.keys());
  }

  /** Send to a specific peer; if `targetPeerId` is omitted, send to every connected peer. */
  send(msg: RoomMessage, targetPeerId?: string): void {
    if (targetPeerId) {
      this.connections.get(targetPeerId)?.send(msg);
      return;
    }
    for (const conn of this.connections.values()) {
      conn.send(msg);
    }
  }

  destroy(): void {
    for (const conn of this.connections.values()) {
      try {
        conn.close();
      } catch {
        // best-effort
      }
    }
    this.connections.clear();
    this.peer.destroy();
  }

  private attachConnection(conn: DataConnection): void {
    conn.on('open', () => {
      this.connections.set(conn.peer, conn);
      this.events.onConnect(conn.peer);
    });
    conn.on('data', (data) => {
      this.events.onMessage(data as RoomMessage, conn.peer);
    });
    conn.on('close', () => {
      this.connections.delete(conn.peer);
      this.events.onDisconnect(conn.peer);
    });
    conn.on('error', (err) => {
      this.events.onError((err as Error).message ?? String(err));
    });
  }
}
