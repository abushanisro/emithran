import { Logger, ServiceUnavailableException, type Provider } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { InMemoryJobQueue } from './in-memory-job-queue.adapter';
import { ELECTRONICS_JOB_QUEUE, type JobHandler, type JobQueue, type QueueHealth } from './job-queue.port';
import { PgBossJobQueue } from './pg-boss-job-queue.adapter';
import { TracedJobQueue } from './traced-job-queue';
import { isTelemetryActive } from '../../../../telemetry/telemetry-state';

// Stands in when the real queue is not configured, so the rest of the app still boots
// and every electronics call says exactly what is missing instead of failing obscurely.
class UnavailableJobQueue implements JobQueue {
  constructor(private readonly reason: string) {}
  private fail(): never {
    throw new ServiceUnavailableException(this.reason);
  }
  async start(): Promise<void> {}
  async stop(): Promise<void> {}
  async enqueue(): Promise<string> {
    return this.fail();
  }
  async work<T extends object>(_queue: string, _handler: JobHandler<T>): Promise<void> {}
  async status(): Promise<never> {
    return this.fail();
  }
  async health(): Promise<QueueHealth> {
    return { configured: false, ready: false };
  }
  async depth(): Promise<number | null> {
    return null;
  }
}

// ELECTRONICS_QUEUE_DRIVER: 'pg-boss' (default) or 'memory' (local development, jobs lost
// on restart). pg-boss needs ELECTRONICS_QUEUE_DATABASE_URL, a direct Postgres connection
// string kept apart from the Supabase API keys.
export const electronicsJobQueueProvider: Provider = {
  provide: ELECTRONICS_JOB_QUEUE,
  inject: [ConfigService],
  useFactory: (config: ConfigService): JobQueue => {
    const queue = createQueue(config);
    // Telemetry wraps whichever backend was chosen, so every adapter (and a future BullMQ one) is traced the same way.
    return isTelemetryActive() ? new TracedJobQueue(queue) : queue;
  },
};

function createQueue(config: ConfigService): JobQueue {
  const logger = new Logger('ElectronicsJobQueue');
  const driver = config.get<string>('ELECTRONICS_QUEUE_DRIVER', 'pg-boss');
  if (driver === 'memory') {
    logger.warn('ELECTRONICS_QUEUE_DRIVER=memory: jobs run in-process and are lost on restart');
    return new InMemoryJobQueue();
  }
  const connectionString = config.get<string>('ELECTRONICS_QUEUE_DATABASE_URL', '');
  if (!connectionString) {
    const reason = 'Electronics queue is not configured: set ELECTRONICS_QUEUE_DATABASE_URL (or ELECTRONICS_QUEUE_DRIVER=memory for local development).';
    logger.warn(reason);
    return new UnavailableJobQueue(reason);
  }
  return new PgBossJobQueue({
    connectionString,
    migrate: config.get<string>('ELECTRONICS_QUEUE_MIGRATE', 'true') !== 'false',
    onError: (error) => { logger.error(`pg-boss: ${error.message}`); },
  });
}
