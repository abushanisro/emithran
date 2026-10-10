import { isCacheable, TtlMemo } from '../../../common/cache/reference-memo';

const make = (now: { t: number }, ttlMs = 1000, maxEntries = 3) => new TtlMemo({ ttlMs, maxEntries, now: () => now.t });

describe('isCacheable', () => {
  it('keeps found data and refuses misses, empties and nothing', () => {
    expect(isCacheable({ minutes: 3, dataFound: true })).toBe(true);
    expect(isCacheable(new Map([[1, 2]]))).toBe(true);
    expect(isCacheable([1])).toBe(true);
    expect(isCacheable({ dataFound: false })).toBe(false);
    expect(isCacheable(new Map())).toBe(false);
    expect(isCacheable([])).toBe(false);
    expect(isCacheable(null)).toBe(false);
    expect(isCacheable(undefined)).toBe(false);
  });
});

describe('TtlMemo', () => {
  it('shares one load between identical concurrent calls', async () => {
    const memo = make({ t: 0 });
    const load = jest.fn(async () => ({ v: 1, dataFound: true }));
    const [a, b] = await Promise.all([memo.get('k', load), memo.get('k', load)]);
    expect(load).toHaveBeenCalledTimes(1);
    expect(a).toEqual(b);
  });

  it('serves a repeat from memory until the TTL passes, then reloads', async () => {
    const now = { t: 0 };
    const memo = make(now);
    const load = jest.fn(async () => ({ v: 1, dataFound: true }));
    await memo.get('k', load);
    now.t = 999;
    await memo.get('k', load);
    expect(load).toHaveBeenCalledTimes(1);
    now.t = 1001;
    await memo.get('k', load);
    expect(load).toHaveBeenCalledTimes(2);
  });

  it('never remembers a miss, an empty answer or a failure', async () => {
    const memo = make({ t: 0 });
    const miss = jest.fn(async () => ({ dataFound: false }));
    await memo.get('m', miss); await memo.get('m', miss);
    expect(miss).toHaveBeenCalledTimes(2);

    const boom = jest.fn(async () => { throw new Error('db down'); });
    await expect(memo.get('e', boom)).rejects.toThrow('db down');
    await expect(memo.get('e', boom)).rejects.toThrow('db down');
    expect(boom).toHaveBeenCalledTimes(2);

    const recovered = jest.fn(async () => ({ v: 2, dataFound: true }));
    await expect(memo.get('e', recovered)).resolves.toEqual({ v: 2, dataFound: true });
    expect(memo.size).toBe(1);
  });

  it('gives every caller its own copy', async () => {
    const memo = make({ t: 0 });
    const first = await memo.get('k', async () => ({ list: [1, 2], dataFound: true }));
    first.list.push(99);
    const second = await memo.get('k', async () => ({ list: [0], dataFound: true }));
    expect(second.list).toEqual([1, 2]);
  });

  it('keeps Maps intact through the copy', async () => {
    const memo = make({ t: 0 });
    const a = await memo.get('m', async () => new Map([['x', 1]]));
    const b = await memo.get('m', async () => new Map());
    expect(Object.prototype.toString.call(a)).toBe('[object Map]');
    expect(b.get('x')).toBe(1);
  });

  it('is bounded: the oldest entry goes when it is full', async () => {
    const memo = make({ t: 0 }, 1000, 2);
    const mk = (v: number) => async () => ({ v, dataFound: true });
    await memo.get('a', mk(1)); await memo.get('b', mk(2)); await memo.get('c', mk(3));
    expect(memo.size).toBe(2);
    const reload = jest.fn(mk(1));
    await memo.get('a', reload);
    expect(reload).toHaveBeenCalledTimes(1);
  });
});
