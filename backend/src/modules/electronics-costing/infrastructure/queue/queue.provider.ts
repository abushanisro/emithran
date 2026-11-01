import { Logger, type Provider } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { InMemoryJobQueue } from './in-memory-job-queue.adapter';
import { ELECTRONICS_JOB_QUEUE, type JobQueue } from './job-queue.port';
import { TableJobQueue } from './table-job-queue.adapter';
import { TracedJobQueue } from './traced-job-queue';
import { DatabaseService } from '../../../../common/database/database.service';
import { isTelemetryActive } from '../../../../telemetry/telemetry-state';

// ELECTRONICS_QUEUE_DRIVER: 'table' (default: the job_queue table, reached through PostgREST) or 'memory' (local development,
// jobs lost on restart).
export const electronicsJobQueueProvider: Provider = {
  provide: ELECTRONICS_JOB_QUEUE,
  inject: [ConfigService, DatabaseService],
  useFactory: (config: ConfigService, database: DatabaseService): JobQueue => {
    const queue = createQueue(config, database);
    // Telemetry wraps whichever backend was chosen, so every adapter (and a future BullMQ one) is traced the same way.
    return isTelemetryActive() ? new TracedJobQueue(queue) : queue;
  },
};

function createQueue(config: ConfigService, database: DatabaseService): JobQueue {
  const logger = new Logger('ElectronicsJobQueue');
  if (config.get<string>('ELECTRONICS_QUEUE_DRIVER', 'table') === 'memory') {
    logger.warn('ELECTRONICS_QUEUE_DRIVER=memory: jobs run in-process and are lost on restart');
    return new InMemoryJobQueue();
  }
  return new TableJobQueue(database.getPrivilegedClient('electronics job queue: the queue table is service-role only, payloads are ids'), {
    onError: (error) => { logger.error(error.message); },
  });
}
