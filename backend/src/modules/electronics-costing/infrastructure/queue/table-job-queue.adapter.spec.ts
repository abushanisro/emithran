import { TableJobQueue } from './table-job-queue.adapter';
import { ELECTRONICS_QUEUES } from './job-queue.port';

type Rpc = { data?: unknown; error?: { message: string } | null };

// A fake of the PostgREST client: rpc() answers from a script, from() serves one canned row. The real SQL is covered by
// test/sql/job_queue.test.sql; these cover what the adapter does around it.
function fake(rpcAnswers: Record<string, Rpc[]>, row: { data: unknown; error?: unknown } = { data: null }) {
  const calls: Array<[string, unknown]> = [];
  const select = jest.fn(() => {
    const chain: any = { eq: () => chain, limit: () => chain, maybeSingle: async () => row, then: (r: (v: unknown) => void) => r({ error: null, count: 4 }) };
    return chain;
  });
  const client = {
    rpc: jest.fn(async (name: string, args: unknown) => {
      calls.push([name, args]);
      return (rpcAnswers[name]?.shift() ?? { data: null, error: null }) as Rpc;
    }),
    from: jest.fn(() => ({ select })),
  };
  return { client: client as never, calls };
}

const options = { onError: jest.fn(), pollMs: 5 };
const until = async (done: () => boolean) => { for (let i = 0; i < 200 && !done(); i++) await new Promise((r) => setTimeout(r, 5)); };

beforeEach(() => options.onError.mockReset());

describe('TableJobQueue', () => {
  it('enqueue returns the id and refuses when the database does not give one', async () => {
    const ok = fake({ enqueue_job: [{ data: 'job-1' }] });
    await expect(new TableJobQueue(ok.client, options).enqueue(ELECTRONICS_QUEUES.parse, { designId: 'd1' })).resolves.toBe('job-1');
    expect(ok.calls[0]).toEqual(['enqueue_job', { p_queue: 'electronics.parse', p_payload: { designId: 'd1' }, p_max_attempts: 3 }]);

    const bad = fake({ enqueue_job: [{ error: { message: 'down' } }] });
    await expect(new TableJobQueue(bad.client, options).enqueue(ELECTRONICS_QUEUES.parse, {})).rejects.toThrow('refused the job: down');
  });

  it('runs a claimed job, stores its output, and then waits instead of spinning', async () => {
    const { client, calls } = fake({ claim_next_job: [{ data: [{ id: 'j1', payload: { n: 1 } }] }] });
    const queue = new TableJobQueue(client, options);
    const handler = jest.fn().mockResolvedValue({ ok: 1 });
    await queue.work(ELECTRONICS_QUEUES.quote, handler);
    await until(() => calls.some(([name]) => name === 'complete_job'));
    await queue.stop();
    expect(handler).toHaveBeenCalledWith({ n: 1 });
    expect(calls).toContainEqual(['complete_job', { p_id: 'j1', p_output: { ok: 1 } }]);
  });

  it('reports a throwing handler to the database as a failed attempt (the database decides on the retry)', async () => {
    const { client, calls } = fake({ claim_next_job: [{ data: [{ id: 'j2', payload: {} }] }] });
    const queue = new TableJobQueue(client, options);
    await queue.work(ELECTRONICS_QUEUES.parse, async () => { throw new Error('bad board'); });
    await until(() => calls.some(([name]) => name === 'fail_job'));
    await queue.stop();
    expect(calls).toContainEqual(['fail_job', { p_id: 'j2', p_error: 'bad board' }]);
  });

  it('logs a failed claim and keeps working', async () => {
    const { client, calls } = fake({ claim_next_job: [{ error: { message: 'network' } }] });
    const queue = new TableJobQueue(client, options);
    await queue.work(ELECTRONICS_QUEUES.parse, async () => ({}));
    await until(() => calls.filter(([name]) => name === 'claim_next_job').length >= 2);
    await queue.stop();
    expect(options.onError).toHaveBeenCalledWith(expect.objectContaining({ message: expect.stringContaining('network') }));
  });

  it('maps a stored row to a status, and a missing row to null', async () => {
    const done = new TableJobQueue(fake({}, { data: { state: 'completed', attempts: 1, output: { id: 'q1' }, error: null } }).client, options);
    await expect(done.status(ELECTRONICS_QUEUES.quote, 'j')).resolves.toEqual({ state: 'completed', attempts: 1, output: { id: 'q1' } });
    const failed = new TableJobQueue(fake({}, { data: { state: 'failed', attempts: 3, output: null, error: 'x' } }).client, options);
    await expect(failed.status(ELECTRONICS_QUEUES.quote, 'j')).resolves.toEqual({ state: 'failed', attempts: 3, error: 'x' });
    await expect(new TableJobQueue(fake({}).client, options).status(ELECTRONICS_QUEUES.quote, 'j')).resolves.toBeNull();
  });

  it('reports health and depth from the table', async () => {
    const queue = new TableJobQueue(fake({}).client, options);
    await expect(queue.health()).resolves.toEqual({ configured: true, ready: true });
    await expect(queue.depth(ELECTRONICS_QUEUES.parse)).resolves.toBe(4);
  });
});
