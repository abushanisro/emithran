import { copyObjects } from './copy-objects';
import type { ObjectStore } from './object-store';

function memoryStore(initial: Record<string, string> = {}, options: { corruptOnPut?: boolean; failGet?: string } = {}) {
  const data = new Map<string, Buffer>(Object.entries(initial).map(([k, v]) => [k, Buffer.from(v)] as [string, Buffer]));
  const puts: string[] = [];
  const store = {
    get: async (_b: string, key: string) => { if (key === options.failGet) throw new Error('boom'); return data.get(key) ?? null; },
    put: async (_b: string, key: string, body: Buffer) => { puts.push(key); data.set(key, options.corruptOnPut ? Buffer.from('garbage') : body); },
  } as unknown as ObjectStore;
  return { store, data, puts };
}

describe('copyObjects', () => {
  it('copies what is missing, skips what is already identical, and re-copies what differs', async () => {
    const src = memoryStore({ a: '1', b: '2', c: '3' });
    const dst = memoryStore({ b: '2', c: 'old' });
    const report = await copyObjects({ source: src.store, destination: dst.store, bucket: 'x', keys: ['a', 'b', 'c'], apply: true });
    expect(report).toEqual({ copied: ['a', 'c'], skipped: ['b'], failed: [] });
    expect(dst.data.get('c')?.toString()).toBe('3');
    expect(dst.puts).toEqual(['a', 'c']);
  });

  it('a dry run reports what it would do and writes nothing', async () => {
    const src = memoryStore({ a: '1' });
    const dst = memoryStore();
    const report = await copyObjects({ source: src.store, destination: dst.store, bucket: 'x', keys: ['a'], apply: false });
    expect(report.copied).toEqual(['a']);
    expect(dst.puts).toEqual([]);
  });

  it('is repeatable: a second run finds everything already there', async () => {
    const src = memoryStore({ a: '1', b: '2' });
    const dst = memoryStore();
    await copyObjects({ source: src.store, destination: dst.store, bucket: 'x', keys: ['a', 'b'], apply: true });
    const again = await copyObjects({ source: src.store, destination: dst.store, bucket: 'x', keys: ['a', 'b'], apply: true });
    expect(again).toEqual({ copied: [], skipped: ['a', 'b'], failed: [] });
  });

  it('reports a copy that reads back differently instead of trusting the write', async () => {
    const report = await copyObjects({ source: memoryStore({ a: '1' }).store, destination: memoryStore({}, { corruptOnPut: true }).store, bucket: 'x', keys: ['a'], apply: true });
    expect(report.failed).toEqual([{ key: 'a', reason: 'the copy read back differently' }]);
    expect(report.copied).toEqual([]);
  });

  it('reports a key missing at the source, and one that errors, and carries on with the rest', async () => {
    const report = await copyObjects({ source: memoryStore({ ok: '1', bad: '2' }, { failGet: 'bad' }).store, destination: memoryStore().store, bucket: 'x', keys: ['gone', 'bad', 'ok'], apply: true });
    expect(report.copied).toEqual(['ok']);
    expect(report.failed).toEqual([{ key: 'gone', reason: 'missing at the source' }, { key: 'bad', reason: 'boom' }]);
  });
});
