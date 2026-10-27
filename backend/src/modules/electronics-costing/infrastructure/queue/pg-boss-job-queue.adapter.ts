import PgBoss from 'pg-boss';

import { withTimeout } from '../../../../common/async/with-timeout';
import {
  ELECTRONICS_QUEUES,
  type ElectronicsQueueName,
  type JobHandler,
  type JobQueue,
  type JobState,
  type JobStatus,
  type QueueHealth,
} from './job-queue.port';

const STATE_MAP: Record<PgBoss.JobWithMetadata['state'], JobState> = {
  created: 'queued',
  retry: 'queued',
  active: 'running',
  completed: 'completed',
  cancelled: 'failed',
  failed: 'failed',
};

const RETRY_LIMIT = 2;
const JOB_EXPIRE_SECONDS = 15 * 60;
const HEALTH_TIMEOUT_MS = 2_000;

export interface PgBossJobQueueOptions {
  connectionString: string;
  /** pg-boss owns its own `pgboss` schema and versions it itself. */
  migrate: boolean;
  onError: (error: Error) => void;
}

// pg-boss on the existing Postgres. Job rows hold ids only; the connection is a
// dedicated queue connection, never used to read tenant data (that stays behind
// SupabaseService and RLS).
export class PgBossJobQueue implements JobQueue {
  private readonly boss: PgBoss;

  constructor(options: PgBossJobQueueOptions) {
    this.boss = new PgBoss({
      connectionString: options.connectionString,
      migrate: options.migrate,
      max: 4,
      application_name: 'emithran-electronics-queue',
    });
    this.boss.on('error', options.onError);
  }

  async start(): Promise<void> {
    await this.boss.start();
    for (const name of Object.values(ELECTRONICS_QUEUES)) {
      await this.boss.createQueue(name);
    }
  }

  async stop(): Promise<void> {
    await this.boss.stop({ graceful: true, timeout: 10_000 });
  }

  async enqueue<TPayload extends object>(queue: ElectronicsQueueName, payload: TPayload): Promise<string> {
    const id = await this.boss.send(queue, payload, {
      retryLimit: RETRY_LIMIT,
      retryBackoff: true,
      expireInSeconds: JOB_EXPIRE_SECONDS,
    });
    if (!id) throw new Error(`Queue ${queue} refused the job`);
    return id;
  }

  async work<TPayload extends object>(queue: ElectronicsQueueName, handler: JobHandler<TPayload>): Promise<void> {
    await this.boss.work<TPayload>(queue, async ([job]) => {
      if (!job) return;
      return handler(job.data);
    });
  }

  // One cheap read through the queue's own connection: proves the database answers AND pg-boss is started.
  async health(): Promise<QueueHealth> {
    try {
      await withTimeout(this.boss.getQueueSize(ELECTRONICS_QUEUES.parse), HEALTH_TIMEOUT_MS, 'pg-boss probe');
      return { configured: true, ready: true };
    } catch {
      return { configured: true, ready: false };
    }
  }

  // Created + retry jobs: the ones waiting for a worker.
  async depth(queue: ElectronicsQueueName): Promise<number | null> {
    return withTimeout(this.boss.getQueueSize(queue), HEALTH_TIMEOUT_MS, 'pg-boss queue size');
  }

  async status(queue: ElectronicsQueueName, jobId: string): Promise<JobStatus | null> {
    const job = await this.boss.getJobById<object>(queue, jobId);
    if (!job) return null;
    const state = STATE_MAP[job.state];
    const output = (job.output ?? undefined) as Record<string, unknown> | undefined;
    const status: JobStatus = { state, attempts: job.retryCount + (job.state === 'created' ? 0 : 1) };
    if (state === 'completed') status.output = output;
    if (state === 'failed') {
      const message = output && typeof output.message === 'string' ? output.message : undefined;
      status.error = message ?? 'Job failed';
    }
    return status;
  }
}
