import { randomUUID } from 'node:crypto';

import type { ElectronicsQueueName, JobHandler, JobQueue, JobStatus } from './job-queue.port';

interface Entry {
  queue: ElectronicsQueueName;
  payload: object;
  status: JobStatus;
}

// A real, in-process implementation of the queue port for local development and the
// pipeline spec: jobs run on the event loop after enqueue, one at a time, and are lost on
// restart. It is selected explicitly (ELECTRONICS_QUEUE_DRIVER=memory), never as a silent
// fallback for a missing database URL.
export class InMemoryJobQueue implements JobQueue {
  private readonly handlers = new Map<ElectronicsQueueName, JobHandler<any>>();
  private readonly jobs = new Map<string, Entry>();
  private chain: Promise<void> = Promise.resolve();

  async start(): Promise<void> {}

  async stop(): Promise<void> {
    await this.idle();
  }

  async enqueue<TPayload extends object>(queue: ElectronicsQueueName, payload: TPayload): Promise<string> {
    const id = randomUUID();
    const entry: Entry = { queue, payload, status: { state: 'queued', attempts: 0 } };
    this.jobs.set(id, entry);
    // One macrotask hop so a freshly enqueued job is observably 'queued', as with a real queue.
    this.chain = this.chain.then(() => new Promise<void>((r) => setImmediate(r))).then(() => this.run(entry));
    return id;
  }

  async work<TPayload extends object>(queue: ElectronicsQueueName, handler: JobHandler<TPayload>): Promise<void> {
    this.handlers.set(queue, handler);
  }

  async status(queue: ElectronicsQueueName, jobId: string): Promise<JobStatus | null> {
    const entry = this.jobs.get(jobId);
    return entry && entry.queue === queue ? { ...entry.status } : null;
  }

  /** Resolves when every enqueued job has finished. For tests. */
  async idle(): Promise<void> {
    await this.chain;
  }

  private async run(entry: Entry): Promise<void> {
    const handler = this.handlers.get(entry.queue);
    entry.status = { state: 'running', attempts: 1 };
    try {
      if (!handler) throw new Error(`No handler registered for ${entry.queue}`);
      const output = await handler(entry.payload);
      entry.status = { state: 'completed', attempts: 1, output };
    } catch (error) {
      entry.status = { state: 'failed', attempts: 1, error: error instanceof Error ? error.message : String(error) };
    }
  }
}
