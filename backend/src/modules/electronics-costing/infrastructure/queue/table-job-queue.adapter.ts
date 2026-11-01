import type { DbClient } from '../../../../common/db/postgrest-client';

import { withTimeout } from '../../../../common/async/with-timeout';
import type { ElectronicsQueueName, JobHandler, JobQueue, JobState, JobStatus, QueueHealth } from './job-queue.port';

const MAX_ATTEMPTS = 3;
const STALE_SECONDS = 15 * 60;
const HEALTH_TIMEOUT_MS = 2_000;
/** Fallback poll. Enqueue wakes the worker at once; this only matters for retries and jobs another instance enqueued. */
const POLL_MS = 15_000;

interface JobRow {
  id: string;
  payload: object;
  state: JobState;
  attempts: number;
  output: Record<string, unknown> | null;
  error: string | null;
}

export interface TableJobQueueOptions {
  /** Called when a claim or a completion write fails, so the problem is logged, never swallowed. */
  onError: (error: Error) => void;
  pollMs?: number;
}

// The job queue on the `job_queue` table (migration 920), reached through PostgREST: no direct database connection.
// Rows hold ids only. One job at a time per queue per process; more instances means more claimers (FOR UPDATE SKIP LOCKED).
export class TableJobQueue implements JobQueue {
  private readonly pollMs: number;
  private readonly loops = new Map<ElectronicsQueueName, { wake: () => void }>();
  private stopping = false;
  private running: Promise<unknown>[] = [];

  constructor(
    private readonly client: DbClient,
    private readonly options: TableJobQueueOptions,
  ) {
    this.pollMs = options.pollMs ?? POLL_MS;
  }

  async start(): Promise<void> {
    this.stopping = false;
  }

  async stop(): Promise<void> {
    this.stopping = true;
    for (const loop of this.loops.values()) loop.wake();
    await Promise.allSettled(this.running);
    this.loops.clear();
    this.running = [];
  }

  async enqueue<TPayload extends object>(queue: ElectronicsQueueName, payload: TPayload): Promise<string> {
    const { data, error } = await this.client.rpc('enqueue_job', { p_queue: queue, p_payload: payload, p_max_attempts: MAX_ATTEMPTS });
    if (error || typeof data !== 'string') throw new Error(`Queue ${queue} refused the job: ${error?.message ?? 'no id returned'}`);
    this.loops.get(queue)?.wake();
    return data;
  }

  async work<TPayload extends object>(queue: ElectronicsQueueName, handler: JobHandler<TPayload>): Promise<void> {
    let wake = () => undefined as void;
    const sleep = () => new Promise<void>((resolve) => {
      const timer = setTimeout(resolve, this.pollMs);
      wake = () => { clearTimeout(timer); resolve(); };
    });
    this.loops.set(queue, { wake: () => wake() });
    this.running.push(this.loop(queue, handler as JobHandler<object>, sleep));
  }

  async status(queue: ElectronicsQueueName, jobId: string): Promise<JobStatus | null> {
    const { data, error } = await this.client.from('job_queue').select('state, attempts, output, error').eq('id', jobId).eq('queue', queue).maybeSingle();
    if (error) throw new Error(`Could not read job ${jobId}: ${error.message}`);
    if (!data) return null;
    const row = data as Pick<JobRow, 'state' | 'attempts' | 'output' | 'error'>;
    const status: JobStatus = { state: row.state, attempts: row.attempts };
    if (row.state === 'completed' && row.output) status.output = row.output;
    if (row.state === 'failed') status.error = row.error ?? 'Job failed';
    return status;
  }

  async health(): Promise<QueueHealth> {
    try {
      const { error } = await withTimeout(
        Promise.resolve(this.client.from('job_queue').select('id', { head: true, count: 'exact' }).limit(1)),
        HEALTH_TIMEOUT_MS,
        'job queue probe',
      );
      return { configured: true, ready: !error };
    } catch {
      return { configured: true, ready: false };
    }
  }

  async depth(queue: ElectronicsQueueName): Promise<number | null> {
    const { count, error } = await withTimeout(
      Promise.resolve(this.client.from('job_queue').select('id', { head: true, count: 'exact' }).eq('queue', queue).eq('state', 'queued')),
      HEALTH_TIMEOUT_MS,
      'job queue depth',
    );
    return error ? null : count;
  }

  private async loop(queue: ElectronicsQueueName, handler: JobHandler<object>, sleep: () => Promise<void>): Promise<void> {
    while (!this.stopping) {
      let claimed = false;
      try {
        claimed = await this.runOne(queue, handler);
      } catch (error) {
        this.options.onError(error instanceof Error ? error : new Error(String(error)));
      }
      if (!claimed && !this.stopping) await sleep();
    }
  }

  /** Claims and runs one job; false when the queue had nothing due. */
  private async runOne(queue: ElectronicsQueueName, handler: JobHandler<object>): Promise<boolean> {
    const { data, error } = await this.client.rpc('claim_next_job', { p_queue: queue, p_stale_seconds: STALE_SECONDS });
    if (error) throw new Error(`Could not claim a ${queue} job: ${error.message}`);
    const job = (Array.isArray(data) ? data[0] : data) as JobRow | undefined;
    if (!job) return false;

    let outcome: { ok: true; output: Record<string, unknown> } | { ok: false; message: string };
    try {
      outcome = { ok: true, output: await handler(job.payload) };
    } catch (failure) {
      outcome = { ok: false, message: failure instanceof Error ? failure.message : String(failure) };
    }
    const written = outcome.ok
      ? await this.client.rpc('complete_job', { p_id: job.id, p_output: outcome.output })
      : await this.client.rpc('fail_job', { p_id: job.id, p_error: outcome.message });
    if (written.error) throw new Error(`Could not record the result of job ${job.id}: ${written.error.message}`);
    return true;
  }
}
