import { EventEmitter } from 'events';

import { InProcessEventBus } from './event-bus';
import { decodeEnvelope, MAX_PAYLOAD_BYTES, NotifyConnection, PG_CHANNEL, PostgresEventBus } from './postgres-event-bus';

/** A fake Postgres server: NOTIFY on any connection reaches every connection that LISTENs, the sender included. */
class FakePostgres {
  readonly listeners = new Set<FakeConnection>();
  down = false;
  connection(): FakeConnection {
    return new FakeConnection(this);
  }
}

class FakeConnection extends EventEmitter implements NotifyConnection {
  constructor(private readonly server: FakePostgres) {
    super();
  }
  async connect() {
    if (this.server.down) throw new Error('ECONNREFUSED');
  }
  async query(sql: string, params?: unknown[]) {
    if (sql.startsWith('LISTEN')) {
      this.server.listeners.add(this);
      return;
    }
    const [channel, payload] = params as [string, string];
    for (const c of this.server.listeners) c.emit('notification', { channel, payload });
  }
  async end() {
    this.server.listeners.delete(this);
  }
}

const flush = () => new Promise((resolve) => setImmediate(resolve));

describe('PostgresEventBus', () => {
  it('delivers an event published on one instance to a subscriber on another (the multi-server SSE defect)', async () => {
    const pg = new FakePostgres();
    const serverA = new PostgresEventBus(() => pg.connection());
    const serverB = new PostgresEventBus(() => pg.connection());
    await serverA.start();
    await serverB.start();

    const seenOnA: string[] = [];
    serverA.subscribe('ppg:user:item', (e) => seenOnA.push(e.type));
    await serverB.publish('ppg:user:item', { type: 'draft_ready', data: { generationId: 'g1' } });
    await flush();

    expect(seenOnA).toEqual(['draft_ready']);
    await serverA.stop();
    await serverB.stop();
  });

  it('keeps channels apart and delivers each event once on the publishing instance', async () => {
    const pg = new FakePostgres();
    const bus = new PostgresEventBus(() => pg.connection());
    await bus.start();
    const mine: string[] = [];
    const other: string[] = [];
    bus.subscribe('a', (e) => mine.push(e.type));
    bus.subscribe('b', (e) => other.push(e.type));
    await bus.publish('a', { type: 'x', data: {} });
    expect(mine).toEqual(['x']);
    expect(other).toEqual([]);
    await bus.stop();
  });

  it('delivers locally while the database is unreachable, and reconnects', async () => {
    jest.useFakeTimers();
    try {
      const pg = new FakePostgres();
      pg.down = true;
      const bus = new PostgresEventBus(() => pg.connection());
      await bus.start();
      expect(bus.isConnected()).toBe(false);
      const seen: string[] = [];
      bus.subscribe('a', (e) => seen.push(e.type));
      await bus.publish('a', { type: 'local', data: {} });
      expect(seen).toEqual(['local']);

      pg.down = false;
      await jest.advanceTimersByTimeAsync(1_000);
      expect(bus.isConnected()).toBe(true);
      await bus.stop();
    } finally {
      jest.useRealTimers();
    }
  });

  it('never sends a payload over the NOTIFY limit; it stays on this instance', async () => {
    const pg = new FakePostgres();
    const sender = new PostgresEventBus(() => pg.connection());
    const other = new PostgresEventBus(() => pg.connection());
    await sender.start();
    await other.start();
    const local: string[] = [];
    const remote: string[] = [];
    sender.subscribe('a', (e) => local.push(e.type));
    other.subscribe('a', (e) => remote.push(e.type));
    await sender.publish('a', { type: 'big', data: { blob: 'x'.repeat(MAX_PAYLOAD_BYTES) } });
    expect(local).toEqual(['big']);
    expect(remote).toEqual([]);
    await sender.stop();
    await other.stop();
  });

  it('ignores malformed notifications and other channels', () => {
    expect(decodeEnvelope('not json')).toBeNull();
    expect(decodeEnvelope(JSON.stringify({ channel: 1 }))).toBeNull();
    expect(decodeEnvelope(JSON.stringify({ channel: 'a', event: { type: 't' } }))).toEqual({ channel: 'a', event: { type: 't', data: {} } });
    expect(PG_CHANNEL).toBe('emithran_events');
  });
});

describe('InProcessEventBus', () => {
  it('a throwing subscriber does not stop the others, and unsubscribe stops delivery', async () => {
    const bus = new InProcessEventBus();
    const seen: string[] = [];
    bus.subscribe('a', () => {
      throw new Error('boom');
    });
    const off = bus.subscribe('a', (e) => seen.push(e.type));
    await bus.publish('a', { type: 'one', data: {} });
    off();
    await bus.publish('a', { type: 'two', data: {} });
    expect(seen).toEqual(['one']);
  });
});
