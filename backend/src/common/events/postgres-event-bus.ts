// The event bus across backend instances: Postgres LISTEN/NOTIFY on one channel, no new infrastructure.
//
// Every instance holds one dedicated connection that LISTENs on `emithran_events`. publish() sends
// pg_notify('emithran_events', '{"channel":...,"event":...}') on that connection; Postgres delivers it to every
// listening session, this one included, and each instance hands it to its own local subscribers. Local subscribers only
// receive events through the notification while connected, so every instance sees the same events in the same order.
//
// The connection must be a session (not a transaction pooler): LISTEN does not survive transaction pooling. On Supabase
// use the direct connection or the session pooler (port 5432), never the transaction pooler (6543).
//
// This connection carries notifications only (event ids and counts), never tenant data, so it does not open a second
// data path around RLS; see docs/rls-bypass-inventory.md.
import { Logger } from '@nestjs/common';
import { Client } from 'pg';

import { BusEvent, BusHandler, EventBus, LocalSubscribers } from './event-bus';

export const PG_CHANNEL = 'emithran_events';
/** Postgres refuses a NOTIFY payload of 8000 bytes or more. */
export const MAX_PAYLOAD_BYTES = 7900;
const RECONNECT_MIN_MS = 1_000;
const RECONNECT_MAX_MS = 30_000;

/** The part of a `pg` Client the bus uses; a fake replaces it in tests. */
export interface NotifyConnection {
  connect(): Promise<unknown>;
  query(sql: string, params?: unknown[]): Promise<unknown>;
  on(event: string, listener: (arg?: any) => void): unknown;
  end(): Promise<unknown>;
}

export function encodeEnvelope(channel: string, event: BusEvent): string {
  return JSON.stringify({ channel, event });
}

export function decodeEnvelope(payload: string | undefined): { channel: string; event: BusEvent } | null {
  if (!payload) return null;
  try {
    const parsed = JSON.parse(payload) as { channel?: unknown; event?: { type?: unknown; data?: unknown } };
    if (typeof parsed.channel !== 'string' || typeof parsed.event?.type !== 'string') return null;
    const data = parsed.event.data && typeof parsed.event.data === 'object' ? (parsed.event.data as Record<string, unknown>) : {};
    return { channel: parsed.channel, event: { type: parsed.event.type, data } };
  } catch {
    return null;
  }
}

export class PostgresEventBus implements EventBus {
  private readonly logger = new Logger(PostgresEventBus.name);
  private readonly local = new LocalSubscribers();
  private connection: NotifyConnection | null = null;
  private connected = false;
  private stopped = false;
  private reconnectMs = RECONNECT_MIN_MS;
  private reconnectTimer: NodeJS.Timeout | null = null;

  constructor(
    private readonly newConnection: () => NotifyConnection = () =>
      new Client({ connectionString: process.env.EVENT_BUS_DATABASE_URL, application_name: 'emithran-event-bus' }),
  ) {}

  async start(): Promise<void> {
    this.stopped = false;
    await this.open();
  }

  async stop(): Promise<void> {
    this.stopped = true;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
    const connection = this.connection;
    this.connection = null;
    this.connected = false;
    if (connection) await connection.end().catch(() => undefined);
  }

  isConnected(): boolean {
    return this.connected;
  }

  async publish(channel: string, event: BusEvent): Promise<void> {
    const payload = encodeEnvelope(channel, event);
    const bytes = Buffer.byteLength(payload, 'utf8');
    if (bytes > MAX_PAYLOAD_BYTES) {
      // Too large for NOTIFY: only subscribers on this instance can receive it. Callers send ids, not documents.
      this.logger.error(`event ${event.type} on ${channel} is ${bytes} bytes, over the ${MAX_PAYLOAD_BYTES}-byte NOTIFY limit; delivered on this instance only`);
      this.deliver(channel, event);
      return;
    }
    const connection = this.connection;
    if (!this.connected || !connection) {
      // Reconnecting: this instance's subscribers still get it; other instances miss it.
      this.logger.warn(`event bus disconnected; ${event.type} on ${channel} delivered on this instance only`);
      this.deliver(channel, event);
      return;
    }
    try {
      await connection.query('SELECT pg_notify($1, $2)', [PG_CHANNEL, payload]);
    } catch (error) {
      this.logger.warn(`NOTIFY failed (${(error as Error).message}); ${event.type} on ${channel} delivered on this instance only`);
      this.deliver(channel, event);
    }
  }

  subscribe(channel: string, handler: BusHandler): () => void {
    return this.local.subscribe(channel, handler);
  }

  private deliver(channel: string, event: BusEvent): void {
    this.local.deliver(channel, event, (error) => this.logger.warn(`event handler failed: ${(error as Error)?.message}`));
  }

  private async open(): Promise<void> {
    const connection = this.newConnection();
    this.connection = connection;
    connection.on('notification', (msg: { channel: string; payload?: string }) => {
      if (msg.channel !== PG_CHANNEL) return;
      const envelope = decodeEnvelope(msg.payload);
      if (envelope) this.deliver(envelope.channel, envelope.event);
    });
    const lost = (error?: Error) => {
      if (this.connection !== connection) return;
      this.connected = false;
      this.connection = null;
      connection.end().catch(() => undefined);
      if (!this.stopped) {
        this.logger.warn(`event bus connection lost${error ? ` (${error.message})` : ''}; reconnecting in ${this.reconnectMs} ms`);
        this.scheduleReconnect();
      }
    };
    connection.on('error', lost);
    connection.on('end', lost);
    try {
      await connection.connect();
      await connection.query(`LISTEN ${PG_CHANNEL}`);
      this.connected = true;
      this.reconnectMs = RECONNECT_MIN_MS;
      this.logger.log(`listening on Postgres channel ${PG_CHANNEL}`);
    } catch (error) {
      lost(error as Error);
    }
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer || this.stopped) return;
    const wait = this.reconnectMs;
    this.reconnectMs = Math.min(this.reconnectMs * 2, RECONNECT_MAX_MS);
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      void this.open();
    }, wait);
  }
}
