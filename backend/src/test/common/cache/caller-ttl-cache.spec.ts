import { CallerTtlCache, ClearsCallerCache } from '../../../common/cache/caller-ttl-cache';

const token = (sub: string | undefined) => `h.${Buffer.from(JSON.stringify(sub === undefined ? {} : { sub })).toString('base64url')}.s`;

describe('CallerTtlCache', () => {
  let clock: number;
  const now = () => clock;
  beforeEach(() => { clock = 1_000; });

  it('reads once and serves the same answer until the entry expires', async () => {
    const cache = new CallerTtlCache(60_000, 500, now);
    const load = jest.fn().mockResolvedValue(['USD', 'INR']);
    expect(await cache.get(token('u1'), 'currencies', load)).toEqual(['USD', 'INR']);
    expect(await cache.get(token('u1'), 'currencies', load)).toEqual(['USD', 'INR']);
    expect(load).toHaveBeenCalledTimes(1);
    clock += 60_001;
    await cache.get(token('u1'), 'currencies', load);
    expect(load).toHaveBeenCalledTimes(2);
  });

  it('never serves one caller another caller\'s answer (the database decides what each may see)', async () => {
    const cache = new CallerTtlCache(60_000, 500, now);
    expect(await cache.get(token('alice'), 'locations', async () => ['Pune'])).toEqual(['Pune']);
    expect(await cache.get(token('bob'), 'locations', async () => ['Berlin'])).toEqual(['Berlin']);
    expect(await cache.get(token('alice'), 'locations', async () => ['never read'])).toEqual(['Pune']);
  });

  it('keeps different questions apart', async () => {
    const cache = new CallerTtlCache(60_000, 500, now);
    await cache.get(token('u1'), 'a', async () => 1);
    expect(await cache.get(token('u1'), 'b', async () => 2)).toBe(2);
  });

  it('does not cache when the caller cannot be identified', async () => {
    const cache = new CallerTtlCache(60_000, 500, now);
    const load = jest.fn().mockResolvedValue('x');
    for (const bad of ['not-a-jwt', token(undefined), 'a.!!!.c', '']) { await cache.get(bad, 'q', load); await cache.get(bad, 'q', load); }
    expect(load).toHaveBeenCalledTimes(8);
  });

  it('shares one read between callers that arrive while it is running', async () => {
    const cache = new CallerTtlCache(60_000, 500, now);
    let release!: (v: string[]) => void;
    const load = jest.fn(() => new Promise<string[]>((res) => { release = res; }));
    const all = [cache.get(token('u1'), 'q', load), cache.get(token('u1'), 'q', load), cache.get(token('u1'), 'q', load)];
    release(['one read']);
    expect(await Promise.all(all)).toEqual([['one read'], ['one read'], ['one read']]);
    expect(load).toHaveBeenCalledTimes(1);
  });

  it('does not remember a failed read: the next call tries again', async () => {
    const cache = new CallerTtlCache(60_000, 500, now);
    const load = jest.fn().mockRejectedValueOnce(new Error('db down')).mockResolvedValueOnce(['ok']);
    await expect(cache.get(token('u1'), 'q', load)).rejects.toThrow('db down');
    expect(await cache.get(token('u1'), 'q', load)).toEqual(['ok']);
  });

  it('is bounded: the oldest entry goes first', async () => {
    const cache = new CallerTtlCache(60_000, 2, now);
    const load = jest.fn().mockImplementation(async () => 'v');
    await cache.get(token('a'), 'q', load); await cache.get(token('b'), 'q', load); await cache.get(token('c'), 'q', load);
    expect(load).toHaveBeenCalledTimes(3);
    await cache.get(token('c'), 'q', load); await cache.get(token('b'), 'q', load);
    expect(load).toHaveBeenCalledTimes(3);
    await cache.get(token('a'), 'q', load);
    expect(load).toHaveBeenCalledTimes(4);
  });

  it('clear() forgets everything', async () => {
    const cache = new CallerTtlCache(60_000, 500, now);
    const load = jest.fn().mockResolvedValue(1);
    await cache.get(token('u1'), 'q', load); cache.clear(); await cache.get(token('u1'), 'q', load);
    expect(load).toHaveBeenCalledTimes(2);
  });
});

describe('ClearsCallerCache', () => {
  class Svc {
    cache = new CallerTtlCache(60_000);
    reads = 0;
    read() { return this.cache.get(token('u1'), 'q', async () => ++this.reads); }
    @ClearsCallerCache('cache') async write(ok: boolean) { if (!ok) throw new Error('write failed half way'); return 'written'; }
  }

  it('empties the cache after a write, and also after a write that failed (it may have changed rows)', async () => {
    const s = new Svc();
    expect(await s.read()).toBe(1); expect(await s.read()).toBe(1);
    expect(await s.write(true)).toBe('written');
    expect(await s.read()).toBe(2);
    await expect(s.write(false)).rejects.toThrow('half way');
    expect(await s.read()).toBe(3);
  });
});
