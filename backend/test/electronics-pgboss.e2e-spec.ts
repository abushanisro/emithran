// The pg-boss adapter against a REAL Postgres: it creates its own pgboss schema, runs a
// handler, reports completed and failed jobs, and retries a failing job. No mocks.
//
// Needs ELECTRONICS_QUEUE_DATABASE_URL: a direct Postgres connection string (Supabase:
// Project Settings > Database > Connection string, session mode). Put it in backend/.env or
// .env.local. Without it this suite fails loudly rather than skipping, so the adapter is never
// silently untested.
import * as fs from 'fs';
import * as path from 'path';
import { parseEnv } from 'util';
import { ELECTRONICS_QUEUES } from '../src/modules/electronics-costing/infrastructure/queue/job-queue.port';
import { PgBossJobQueue } from '../src/modules/electronics-costing/infrastructure/queue/pg-boss-job-queue.adapter';

jest.setTimeout(120_000);

function connectionString(): string {
  if (process.env.ELECTRONICS_QUEUE_DATABASE_URL) return process.env.ELECTRONICS_QUEUE_DATABASE_URL;
  for (const file of ['../.env', '../../.env.local']) {
    const full = path.resolve(__dirname, file);
    if (!fs.existsSync(full)) continue;
    const value = parseEnv(fs.readFileSync(full, 'utf8')).ELECTRONICS_QUEUE_DATABASE_URL;
    if (value) return value;
  }
  throw new Error('Set ELECTRONICS_QUEUE_DATABASE_URL to a direct Postgres connection string to run this suite.');
}

async function until<T>(read: () => Promise<T>, done: (v: T) => boolean, ms = 60_000): Promise<T> {
  const deadline = Date.now() + ms;
  for (;;) {
    const v = await read();
    if (done(v) || Date.now() > deadline) return v;
    await new Promise((r) => setTimeout(r, 500));
  }
}

describe('[e2e] PgBossJobQueue — real Postgres', () => {
  let queue: PgBossJobQueue;
  const errors: Error[] = [];

  beforeAll(async () => {
    queue = new PgBossJobQueue({ connectionString: connectionString(), migrate: true, onError: (e) => errors.push(e) });
    await queue.start();
  });

  afterAll(async () => {
    await queue.stop();
  });

  it('runs a handler with the payload and exposes its output as completed', async () => {
    await queue.work<{ n: number }>(ELECTRONICS_QUEUES.parse, async ({ n }) => ({ doubled: n * 2 }));
    const id = await queue.enqueue(ELECTRONICS_QUEUES.parse, { n: 21 });
    const status = await until(
      () => queue.status(ELECTRONICS_QUEUES.parse, id),
      (s) => s?.state === 'completed' || s?.state === 'failed',
    );
    expect(status).toMatchObject({ state: 'completed', output: { doubled: 42 } });
  });

  it('reports a job that keeps throwing as failed with its message, after its retries', async () => {
    await queue.work(ELECTRONICS_QUEUES.quote, async () => {
      throw new Error('boom');
    });
    const id = await queue.enqueue(ELECTRONICS_QUEUES.quote, {});
    const status = await until(
      () => queue.status(ELECTRONICS_QUEUES.quote, id),
      (s) => s?.state === 'failed',
      110_000,
    );
    expect(status?.state).toBe('failed');
    expect(status?.error).toContain('boom');
    expect(status?.attempts).toBeGreaterThan(1);
  });

  it('returns null for an unknown job id and never reports another queue job', async () => {
    expect(await queue.status(ELECTRONICS_QUEUES.parse, '00000000-0000-4000-8000-000000000000')).toBeNull();
  });

  it('raised no connection errors', () => {
    expect(errors).toEqual([]);
  });
});
