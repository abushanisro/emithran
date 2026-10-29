// The table job queue (migration 920) against the REAL database over the Supabase API: runs a handler, reports completed and
// failed jobs, and retries a failing job. No mocks. Needs SUPABASE_URL and SUPABASE_SERVICE_KEY (process env or backend/.env) and
// migration 920 applied. Fails loudly instead of skipping, so the adapter is never silently untested.
import { createClient } from '@supabase/supabase-js';
import * as fs from 'fs';
import * as path from 'path';
import { parseEnv } from 'util';
import { ELECTRONICS_QUEUES } from '../src/modules/electronics-costing/infrastructure/queue/job-queue.port';
import { TableJobQueue } from '../src/modules/electronics-costing/infrastructure/queue/table-job-queue.adapter';

jest.setTimeout(120_000);

function setting(name: string): string {
  const fromFile = fs.existsSync(path.resolve(__dirname, '../.env')) ? parseEnv(fs.readFileSync(path.resolve(__dirname, '../.env'), 'utf8'))[name] : undefined;
  const value = process.env[name] ?? fromFile;
  if (!value) throw new Error(`Set ${name} (process env or backend/.env) to run this suite.`);
  return value;
}

async function until<T>(read: () => Promise<T>, done: (v: T) => boolean, ms = 60_000): Promise<T> {
  const deadline = Date.now() + ms;
  for (;;) {
    const v = await read();
    if (done(v) || Date.now() > deadline) return v;
    await new Promise((r) => setTimeout(r, 500));
  }
}

describe('[e2e] TableJobQueue: real database', () => {
  let queue: TableJobQueue;
  const errors: Error[] = [];

  beforeAll(async () => {
    queue = new TableJobQueue(createClient(setting('SUPABASE_URL'), setting('SUPABASE_SERVICE_KEY')), { onError: (e) => errors.push(e), pollMs: 1_000 });
    await queue.start();
  });

  afterAll(async () => {
    await queue.stop();
  });

  it('runs a handler with the payload and exposes its output as completed', async () => {
    await queue.work<{ n: number }>(ELECTRONICS_QUEUES.parse, async ({ n }) => ({ doubled: n * 2 }));
    const id = await queue.enqueue(ELECTRONICS_QUEUES.parse, { n: 21 });
    const status = await until(() => queue.status(ELECTRONICS_QUEUES.parse, id), (s) => s?.state === 'completed' || s?.state === 'failed');
    expect(status).toMatchObject({ state: 'completed', output: { doubled: 42 } });
    expect(errors).toEqual([]);
  });

  it('reports a job that keeps throwing as failed with its message, after its retries', async () => {
    await queue.work(ELECTRONICS_QUEUES.quote, async () => {
      throw new Error('boom');
    });
    const id = await queue.enqueue(ELECTRONICS_QUEUES.quote, {});
    const status = await until(() => queue.status(ELECTRONICS_QUEUES.quote, id), (s) => s?.state === 'failed', 110_000);
    expect(status).toMatchObject({ state: 'failed', attempts: 3 });
    expect(status?.error).toContain('boom');
  });

  it('answers the readiness probe and the depth read', async () => {
    await expect(queue.health()).resolves.toEqual({ configured: true, ready: true });
    await expect(queue.depth(ELECTRONICS_QUEUES.parse)).resolves.toEqual(expect.any(Number));
  });
});
