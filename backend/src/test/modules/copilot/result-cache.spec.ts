import { ResultCache } from '../../../modules/copilot/copilot.tools';

describe('ResultCache', () => {
  it('computes once per key within the TTL, and separately per key', async () => {
    const cache = new ResultCache(10_000);
    let runs = 0;
    const compute = async () => ++runs;
    expect(await Promise.all([cache.get('user-a|item', compute), cache.get('user-a|item', compute)])).toEqual([1, 1]);
    expect(await cache.get('user-a|item', compute)).toBe(1);
    expect(await cache.get('user-b|item', compute)).toBe(2);
  });

  it('recomputes after the TTL', async () => {
    const cache = new ResultCache(20);
    let runs = 0;
    const compute = async () => ++runs;
    expect(await cache.get('k', compute)).toBe(1);
    await new Promise((r) => setTimeout(r, 40));
    expect(await cache.get('k', compute)).toBe(2);
  });

  it('never caches a failure', async () => {
    const cache = new ResultCache(10_000);
    await expect(cache.get('k', () => Promise.reject(new Error('boom')))).rejects.toThrow('boom');
    await new Promise((r) => setImmediate(r));
    expect(await cache.get('k', async () => 'ok')).toBe('ok');
  });

  it('keeps at most maxEntries, dropping the oldest', async () => {
    const cache = new ResultCache(10_000, 2);
    let runs = 0;
    const compute = async () => ++runs;
    await cache.get('a', compute);
    await cache.get('b', compute);
    await cache.get('c', compute);
    expect(await cache.get('a', compute)).toBe(4);
  });
});
