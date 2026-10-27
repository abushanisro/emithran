import { HealthCheckError } from '@nestjs/terminus';

import type { JobQueue, QueueHealth } from './job-queue.port';
import { ElectronicsQueueHealthIndicator } from './queue.health';

const indicator = (health: () => Promise<QueueHealth>) => new ElectronicsQueueHealthIndicator({ health } as unknown as JobQueue);

describe('ElectronicsQueueHealthIndicator', () => {
  it('is up when the queue answers', async () => {
    await expect(indicator(async () => ({ configured: true, ready: true })).check('electronics_queue')).resolves.toEqual({
      electronics_queue: { status: 'up', configured: true },
    });
  });

  it('is up, and says it is not configured, when no queue backend was set up (the rest of the API is fine)', async () => {
    await expect(indicator(async () => ({ configured: false, ready: false })).check('electronics_queue')).resolves.toEqual({
      electronics_queue: { status: 'up', configured: false },
    });
  });

  it('is down with a reason code when a configured queue does not answer', async () => {
    const error = await indicator(async () => ({ configured: true, ready: false })).check('electronics_queue').catch((e) => e);
    expect(error).toBeInstanceOf(HealthCheckError);
    expect(error.causes).toEqual({ electronics_queue: { status: 'down', configured: true, reason: 'unreachable' } });
  });

  it('treats a probe that throws as down rather than letting it escape', async () => {
    const error = await indicator(async () => { throw new Error('boom'); }).check('electronics_queue').catch((e) => e);
    expect(error).toBeInstanceOf(HealthCheckError);
    expect(JSON.stringify(error.causes)).not.toContain('boom'); // a code, never the driver message
  });
});
