// Keeps one device's copy of an online match in step with the room's action
// log. The log is the source of truth: every device builds the opening from
// the start record (createMatch is pure) and applies the log in slot order.
//
// This device's own moves show at once (optimistic) and wait in `pending`;
// the head is written to the next free slot. When it comes back through the
// log listener it's confirmed. When another device's move took the slot
// first, the pending moves are replayed on top of the new state and the ones
// that are no longer legal are dropped (with a notice, unless they were AI
// moves another device also made — those are dropped quietly).

import { checksum, createMatch, tryApply, type Action, type MatchState } from '@/core/engine';
import { nonce, type LoggedAction, type RoomConnection, type StartRecord } from './room';

interface Pending {
  action: Action;
  nonce: string;
  quiet: boolean;
}

export class MatchSync {
  base: MatchState | null = null;
  start: StartRecord | null = null;
  private nextSeq = 0;
  private buffer = new Map<number, LoggedAction>();
  private pending: Pending[] = [];
  private inflight = false;
  private stopped = false;

  constructor(
    private readonly room: Pick<RoomConnection, 'appendAction'>,
    private readonly match: number,
    private readonly onChange: () => void,
    private readonly notice: (text: string) => void,
  ) {}

  stop(): void {
    this.stopped = true;
  }

  onStart(record: StartRecord): void {
    if (this.base) return;
    this.start = record;
    this.base = createMatch(record.config);
    if (checksum(this.base) !== record.check) {
      this.notice('This device built a different opening than the host — you may be on another version of the app. Reload to update.');
    }
    this.drain();
    this.onChange();
  }

  onAction(seq: number, entry: LoggedAction): void {
    this.buffer.set(seq, entry);
    this.drain();
  }

  /** The state to show: the confirmed log plus this device's pending moves. */
  view(): MatchState | null {
    let s = this.base;
    if (!s) return null;
    for (const p of this.pending) s = tryApply(s, p.action) ?? s;
    return s;
  }

  /** Queue a move from this device; false when it isn't legal in the current view. */
  submit(action: Action, quiet = false): boolean {
    const v = this.view();
    if (!v || !tryApply(v, action)) return false;
    this.pending.push({ action, nonce: nonce(), quiet });
    this.onChange();
    void this.flush();
    return true;
  }

  private drain(): void {
    if (!this.base) return;
    let changed = false;
    while (this.buffer.has(this.nextSeq)) {
      const entry = this.buffer.get(this.nextSeq)!;
      this.buffer.delete(this.nextSeq);
      this.nextSeq++;
      // An illegal entry (a race no device could prevent) is skipped by every device alike.
      this.base = tryApply(this.base, entry.action as Action) ?? this.base;
      if (this.pending[0]?.nonce === entry.nonce) {
        this.pending.shift();
        this.inflight = false;
      }
      changed = true;
    }
    if (!changed) return;
    this.revalidate();
    this.onChange();
    void this.flush();
  }

  /** Drop pending moves the confirmed state no longer allows. */
  private revalidate(): void {
    let s = this.base!;
    const keep: Pending[] = [];
    for (const p of this.pending) {
      const next = tryApply(s, p.action);
      if (next) {
        keep.push(p);
        s = next;
      } else if (!p.quiet) {
        this.notice('Another player moved first, so your move was taken back.');
      }
    }
    if (this.inflight && keep[0] !== this.pending[0]) this.inflight = false;
    this.pending = keep;
  }

  private async flush(): Promise<void> {
    if (this.stopped || this.inflight || !this.base) return;
    const head = this.pending[0];
    if (!head) return;
    this.inflight = true;
    try {
      const ok = await this.room.appendAction(this.match, this.nextSeq, { action: head.action, nonce: head.nonce });
      if (!ok && this.pending[0] === head) {
        // Another device's move holds the slot: once it arrives, try the next one.
        this.inflight = false;
        setTimeout(() => void this.flush(), 60);
      }
    } catch {
      if (this.pending[0] === head) {
        this.pending.shift();
        this.inflight = false;
        if (!head.quiet) this.notice('The server refused that move.');
        this.onChange();
        void this.flush();
      }
    }
  }
}
