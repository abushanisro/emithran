import { cachedBatch, runWithRequestCache } from '../../../modules/bom-items/costing/shared/core/request-cache';

// The shape measured on the live database: route comparison attaches every route; each route's machine
// set differs but shares the same two machines, which were re-read 14 times in one second.
describe('cachedBatch (one request, per id)', () => {
  const makeLoader = () => {
    const calls: string[][] = [];
    const load = async (missing: string[]) => {
      calls.push([...missing]);
      return new Map(missing.map((id) => [id, `row-${id}`]));
    };
    return { calls, load };
  };

  it('reads each id once across overlapping sets', async () => {
    const { calls, load } = makeLoader();
    await runWithRequestCache(async () => {
      await cachedBatch('t', ['a', 'b', 'c'], load);
      await cachedBatch('t', ['a', 'b', 'd'], load);
      await cachedBatch('t', ['a', 'b'], load);
    });
    expect(calls).toEqual([['a', 'b', 'c'], ['d']]);
  });

  it('concurrent overlapping callers share the in-flight loads', async () => {
    const { calls, load } = makeLoader();
    const results = await runWithRequestCache(() => Promise.all([
      cachedBatch('t', ['a', 'b', 'c'], load),
      cachedBatch('t', ['a', 'b', 'd'], load),
      cachedBatch('t', ['a', 'e'], load),
    ]));
    expect(calls.flat().sort()).toEqual(['a', 'b', 'c', 'd', 'e']);
    expect([...results[1]!.keys()].sort()).toEqual(['a', 'b', 'd']);
    expect(results[2]!.get('a')).toBe('row-a');
  });

  it('an id the load did not return is simply absent, and scopes do not share', async () => {
    const calls: string[][] = [];
    const load = async (m: string[]) => { calls.push(m); return new Map<string, string>(); };
    const out = await runWithRequestCache(() => cachedBatch('t', ['x'], load));
    expect(out.size).toBe(0);
    await runWithRequestCache(() => cachedBatch('t', ['x'], load));
    expect(calls).toEqual([['x'], ['x']]);
  });

  it('a failed load is not remembered: the next caller retries, and every waiting caller sees the failure', async () => {
    let n = 0;
    const load = async (m: string[]) => { if (n++ === 0) throw new Error('boom'); return new Map(m.map((id) => [id, 'ok'])); };
    await runWithRequestCache(async () => {
      await expect(cachedBatch('t', ['a'], load)).rejects.toThrow('boom');
      expect((await cachedBatch('t', ['a'], load)).get('a')).toBe('ok');
    });
  });

  it('outside a request every call loads (no cache, still correct)', async () => {
    const { calls, load } = makeLoader();
    await cachedBatch('t', ['a'], load);
    await cachedBatch('t', ['a'], load);
    expect(calls).toHaveLength(2);
  });
});
