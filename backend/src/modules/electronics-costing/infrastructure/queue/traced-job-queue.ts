import { observeQueueDepth } from '../../../../telemetry/metrics';
import { runJob, withTraceparent } from '../../../../telemetry/job-trace';
import { ELECTRONICS_QUEUES, type ElectronicsQueueName, type JobHandler, type JobQueue, type JobStatus, type QueueHealth } from './job-queue.port';

// Telemetry around any JobQueue (the job_queue table today, BullMQ tomorrow) without touching the adapter or the use cases:
// the producer's trace travels in the payload, each worker attempt is a span and a duration, and the number of
// waiting jobs is a gauge. Only built when telemetry is on (queue.provider.ts); otherwise the adapter is used as is.
export class TracedJobQueue implements JobQueue {
  constructor(private readonly inner: JobQueue) {
    observeQueueDepth(Object.values(ELECTRONICS_QUEUES), (queue) => inner.depth(queue as ElectronicsQueueName));
  }

  start(): Promise<void> {
    return this.inner.start();
  }

  stop(): Promise<void> {
    return this.inner.stop();
  }

  enqueue<TPayload extends object>(queue: ElectronicsQueueName, payload: TPayload): Promise<string> {
    return this.inner.enqueue(queue, withTraceparent(payload));
  }

  work<TPayload extends object>(queue: ElectronicsQueueName, handler: JobHandler<TPayload>): Promise<void> {
    return this.inner.work<TPayload>(queue, (payload) => runJob(queue, payload, handler));
  }

  status(queue: ElectronicsQueueName, jobId: string): Promise<JobStatus | null> {
    return this.inner.status(queue, jobId);
  }

  health(): Promise<QueueHealth> {
    return this.inner.health();
  }

  depth(queue: ElectronicsQueueName): Promise<number | null> {
    return this.inner.depth(queue);
  }
}
