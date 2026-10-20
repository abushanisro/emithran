import { InMemoryJobQueue } from './in-memory-job-queue.adapter';
import { ELECTRONICS_QUEUES } from './job-queue.port';

describe('InMemoryJobQueue (the queue port, in process)', () => {
  it('runs a handler with the payload and exposes its output', async () => {
    const queue = new InMemoryJobQueue();
    await queue.work<{ n: number }>(ELECTRONICS_QUEUES.parse, async ({ n }) => ({ doubled: n * 2 }));
    const id = await queue.enqueue(ELECTRONICS_QUEUES.parse, { n: 21 });
    await queue.idle();
    expect(await queue.status(ELECTRONICS_QUEUES.parse, id)).toEqual({
      state: 'completed',
      attempts: 1,
      output: { doubled: 42 },
    });
  });

  it('reports a thrown handler as failed with its message', async () => {
    const queue = new InMemoryJobQueue();
    await queue.work(ELECTRONICS_QUEUES.quote, async () => {
      throw new Error('boom');
    });
    const id = await queue.enqueue(ELECTRONICS_QUEUES.quote, {});
    await queue.idle();
    expect(await queue.status(ELECTRONICS_QUEUES.quote, id)).toMatchObject({ state: 'failed', error: 'boom' });
  });

  it('fails a job whose queue has no handler instead of leaving it queued forever', async () => {
    const queue = new InMemoryJobQueue();
    const id = await queue.enqueue(ELECTRONICS_QUEUES.parse, {});
    await queue.idle();
    expect(await queue.status(ELECTRONICS_QUEUES.parse, id)).toMatchObject({ state: 'failed' });
  });

  it('is queued before it runs, and unknown or wrong-queue ids are null', async () => {
    const queue = new InMemoryJobQueue();
    await queue.work(ELECTRONICS_QUEUES.parse, async () => ({}));
    const id = await queue.enqueue(ELECTRONICS_QUEUES.parse, {});
    expect(await queue.status(ELECTRONICS_QUEUES.parse, id)).toMatchObject({ state: 'queued' });
    await queue.idle();
    expect(await queue.status(ELECTRONICS_QUEUES.quote, id)).toBeNull();
    expect(await queue.status(ELECTRONICS_QUEUES.parse, 'missing')).toBeNull();
  });

  it('runs jobs one at a time, in order', async () => {
    const queue = new InMemoryJobQueue();
    const order: number[] = [];
    await queue.work<{ n: number }>(ELECTRONICS_QUEUES.parse, async ({ n }) => {
      await new Promise((r) => setTimeout(r, n === 1 ? 20 : 0));
      order.push(n);
      return {};
    });
    await queue.enqueue(ELECTRONICS_QUEUES.parse, { n: 1 });
    await queue.enqueue(ELECTRONICS_QUEUES.parse, { n: 2 });
    await queue.idle();
    expect(order).toEqual([1, 2]);
  });
});
