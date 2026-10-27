import { Inject, Injectable } from '@nestjs/common';
import { HealthCheckError, HealthIndicator, type HealthIndicatorResult } from '@nestjs/terminus';

import { ELECTRONICS_JOB_QUEUE, type JobQueue } from './job-queue.port';

// Readiness of the electronics job queue. Owned by this module (it knows its own queue); the health module only
// calls it. A queue with no backend configured is `configured: false` and does not fail readiness: electronics
// calls report that themselves and the rest of the API is fine. A configured queue that does not answer is down.
@Injectable()
export class ElectronicsQueueHealthIndicator extends HealthIndicator {
  constructor(@Inject(ELECTRONICS_JOB_QUEUE) private readonly queue: JobQueue) {
    super();
  }

  async check(key: string): Promise<HealthIndicatorResult> {
    const { configured, ready } = await this.queue.health().catch(() => ({ configured: true, ready: false }));
    if (!configured) return this.getStatus(key, true, { configured: false });
    if (ready) return this.getStatus(key, true, { configured: true });
    throw new HealthCheckError(`${key} is not ready`, this.getStatus(key, false, { configured: true, reason: 'unreachable' }));
  }
}
