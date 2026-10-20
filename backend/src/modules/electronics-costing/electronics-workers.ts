import { Inject, Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';

import { ProcessParseJob } from './application/process-parse-job';
import { ProcessQuoteJob, type QuoteJobPayload } from './application/quote.use-cases';
import { ELECTRONICS_JOB_QUEUE, ELECTRONICS_QUEUES, type JobQueue } from './infrastructure/queue/job-queue.port';

import type { ParseJobPayload } from './application/start-upload.use-case';

// Starts the queue and attaches the two handlers. A queue that cannot start is logged and
// leaves the rest of the API running; electronics endpoints then fail on enqueue/status.
@Injectable()
export class ElectronicsWorkers implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ElectronicsWorkers.name);

  constructor(
    @Inject(ELECTRONICS_JOB_QUEUE) private readonly queue: JobQueue,
    private readonly parseJob: ProcessParseJob,
    private readonly quoteJob: ProcessQuoteJob,
  ) {}

  async onModuleInit(): Promise<void> {
    try {
      await this.queue.start();
      await this.queue.work<ParseJobPayload>(ELECTRONICS_QUEUES.parse, (p) => this.parseJob.run(p));
      await this.queue.work<QuoteJobPayload>(ELECTRONICS_QUEUES.quote, (p) => this.quoteJob.run(p));
    } catch (error) {
      this.logger.error(`Electronics queue failed to start: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  async onModuleDestroy(): Promise<void> {
    await this.queue.stop().catch((error: unknown) => {
      this.logger.warn(`Electronics queue stop: ${error instanceof Error ? error.message : String(error)}`);
    });
  }
}
