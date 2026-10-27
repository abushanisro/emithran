import { PgBossJobQueue } from './pg-boss-job-queue.adapter';
import { ELECTRONICS_QUEUES } from './job-queue.port';

// pg-boss itself is replaced: these cover only what the adapter adds around it (the readiness probe and the depth read).
// The real library against a real database is covered by test/electronics-pgboss.e2e-spec.ts.
const mockBoss = { on: jest.fn(), getQueueSize: jest.fn() };
jest.mock('pg-boss', () => jest.fn(() => mockBoss));

const queue = () => new PgBossJobQueue({ connectionString: 'postgres://unused', migrate: false, onError: () => undefined });

beforeEach(() => {
  mockBoss.getQueueSize.mockReset();
  jest.useRealTimers();
});

describe('PgBossJobQueue.health', () => {
  it('is ready when the library answers a queue-size read', async () => {
    mockBoss.getQueueSize.mockResolvedValue(0);
    await expect(queue().health()).resolves.toEqual({ configured: true, ready: true });
    expect(mockBoss.getQueueSize).toHaveBeenCalledWith(ELECTRONICS_QUEUES.parse);
  });

  it('is not ready, and does not throw, when the read fails (database down, pg-boss not started)', async () => {
    mockBoss.getQueueSize.mockRejectedValue(new Error('connection terminated'));
    await expect(queue().health()).resolves.toEqual({ configured: true, ready: false });
  });

  it('is not ready after its 2 s bound when the read never settles', async () => {
    jest.useFakeTimers();
    mockBoss.getQueueSize.mockReturnValue(new Promise(() => undefined));
    const result = queue().health();
    await jest.advanceTimersByTimeAsync(2_000);
    await expect(result).resolves.toEqual({ configured: true, ready: false });
  });
});

describe('PgBossJobQueue.depth', () => {
  it('reads the number of waiting jobs of that queue', async () => {
    mockBoss.getQueueSize.mockResolvedValue(5);
    await expect(queue().depth(ELECTRONICS_QUEUES.quote)).resolves.toBe(5);
    expect(mockBoss.getQueueSize).toHaveBeenCalledWith(ELECTRONICS_QUEUES.quote);
  });

  it('rejects after its bound rather than waiting on a hung database (the gauge skips it)', async () => {
    jest.useFakeTimers();
    mockBoss.getQueueSize.mockReturnValue(new Promise(() => undefined));
    const result = queue().depth(ELECTRONICS_QUEUES.parse);
    const settled = expect(result).rejects.toThrow(/timed out/);
    await jest.advanceTimersByTimeAsync(2_000);
    await settled;
  });
});
