import { describe, expect, it } from 'vitest';
import { chooseAction } from '@/core/ai';
import { checksum, createMatch, pendingSeats, type MatchConfig } from '@/core/engine';
import { DEFAULT_HK_RULES } from '@/core/variants/hk';
import type { LoggedAction, StartRecord } from './room';
import { MatchSync } from './sync';

/** An in-memory action log with the database's write-once slots and async delivery. */
class FakeLog {
  slots: LoggedAction[] = [];
  listeners: ((seq: number, e: LoggedAction) => void)[] = [];
  async appendAction(_m: number, seq: number, entry: LoggedAction): Promise<boolean> {
    await Promise.resolve();
    if (seq !== this.slots.length) return false;
    this.slots.push(entry);
    const at = seq;
    setTimeout(() => this.listeners.forEach((l) => l(at, entry)), Math.random() * 5);
    return true;
  }
}

const config: MatchConfig = {
  variant: 'hk',
  rules: DEFAULT_HK_RULES,
  seed: 77,
  seats: [
    { name: 'Host', ai: false, uuid: 'h' },
    { name: 'Guest', ai: false, uuid: 'g' },
    { name: 'Bot A', ai: true, level: 'normal' },
    { name: 'Bot B', ai: true, level: 'easy' },
  ],
};
const record: StartRecord = { config, hostUuid: 'h', startedAt: 0, check: checksum(createMatch(config)) };

function device(log: FakeLog) {
  const notices: string[] = [];
  const sync = new MatchSync(log, 0, () => {}, (t) => notices.push(t));
  log.listeners.push((seq, e) => sync.onAction(seq, e));
  sync.onStart(record);
  return { sync, notices };
}

const settle = () => new Promise((r) => setTimeout(r, 20));

describe('MatchSync', () => {
  it('two devices (one also driving the AI) stay in step through a whole hand', async () => {
    const log = new FakeLog();
    const host = device(log);
    const guest = device(log);
    for (let step = 0; step < 400; step++) {
      const v = host.sync.view()!;
      if (v.hand.phase === 'end') break;
      const seat = pendingSeats(v)[0]!;
      // Seat 1 belongs to the guest's device; the host plays seat 0 and the bots.
      const dev = seat === 1 ? guest : host;
      const state = dev.sync.view()!;
      const action = chooseAction(state, seat)!;
      expect(dev.sync.submit(action, seat > 1)).toBe(true);
      await settle();
    }
    await settle();
    expect(host.sync.view()!.hand.phase).toBe('end');
    expect(JSON.stringify(guest.sync.base)).toBe(JSON.stringify(host.sync.base));
    expect(log.slots.length).toBe(host.sync.base!.seq);
  });

  it('a race for one slot keeps the first move and takes the other back', async () => {
    const log = new FakeLog();
    const a = device(log);
    const b = device(log);
    const v = a.sync.view()!;
    const dealer = v.dealer;
    const tiles = v.hand.players[dealer]!.hand;
    // Both devices try to discard for the dealer at once (e.g. a host hand-off).
    a.sync.submit({ type: 'discard', seat: dealer, tile: tiles[0]! });
    b.sync.submit({ type: 'discard', seat: dealer, tile: tiles[1]! });
    await settle();
    await settle();
    expect(log.slots).toHaveLength(1);
    expect(JSON.stringify(a.sync.view())).toBe(JSON.stringify(b.sync.view()));
    expect([...a.notices, ...b.notices]).toHaveLength(1);
  });

  it('a late joiner replays the log to the same state', async () => {
    const log = new FakeLog();
    const host = device(log);
    for (let i = 0; i < 30; i++) {
      const v = host.sync.view()!;
      const seat = pendingSeats(v)[0]!;
      host.sync.submit(chooseAction(v, seat)!, true);
      await settle();
    }
    const late = new MatchSync(log, 0, () => {}, () => {});
    late.onStart(record);
    log.slots.forEach((e, i) => late.onAction(i, e));
    expect(JSON.stringify(late.base)).toBe(JSON.stringify(host.sync.base));
  });
});
