import { describe, expect, it, vi } from 'vitest';

import { GeometryStore, storageKey } from '@/lib/viewer/geometry-store';
import { isBinaryStl, parseStl } from '@/lib/viewer/stl-parse';

const tri = (n: number) => new Float32Array(n * 9).fill(1);

function makeStore(maxBytes: number) {
  const fetchBuffer = vi.fn(async () => new ArrayBuffer(8));
  const parse = vi.fn(async () => tri(10)); // 360 bytes
  return { store: new GeometryStore({ maxBytes, fetchBuffer, parse }), fetchBuffer, parse };
}

describe('storageKey', () => {
  it('drops the signed token so a refreshed URL is the same part', () => {
    expect(storageKey('https://x.supabase.co/storage/v1/object/sign/bom/a/b.stl?token=abc'))
      .toBe(storageKey('https://x.supabase.co/storage/v1/object/sign/bom/a/b.stl?token=xyz'));
  });
});

describe('GeometryStore', () => {
  it('two concurrent loads of one part fetch and parse once', async () => {
    const { store, fetchBuffer, parse } = makeStore(10_000);
    const [a, b] = await Promise.all([store.acquire('/p/a.stl?t=1'), store.acquire('/p/a.stl?t=2')]);
    expect(a.mesh).toBe(b.mesh);
    expect(fetchBuffer).toHaveBeenCalledTimes(1);
    expect(parse).toHaveBeenCalledTimes(1);
    expect(a.mesh.triTotal).toBe(10);
  });

  it('a later request for a finished part is served from cache', async () => {
    const { store, fetchBuffer } = makeStore(10_000);
    (await store.acquire('/p/a.stl')).release();
    await store.acquire('/p/a.stl');
    expect(fetchBuffer).toHaveBeenCalledTimes(1);
  });

  it('evicts the least-recently-used unreferenced mesh when over budget, never a held one', async () => {
    const { store } = makeStore(400); // room for one 360-byte mesh
    const a = await store.acquire('/p/a.stl');
    const b = await store.acquire('/p/b.stl'); // over budget, but a is still held
    expect(store.stats().entries).toBe(2);
    a.release();
    expect(store.stats().entries).toBe(1); // a evicted, b (held) kept
    b.release();
    expect(store.stats().entries).toBe(1); // within budget: stays cached
  });

  it('release is idempotent', async () => {
    const { store } = makeStore(10);
    const a = await store.acquire('/p/a.stl');
    a.release();
    a.release();
    expect(store.stats().entries).toBe(0);
  });
});

describe('parseStl', () => {
  it('reads binary STL in file order', () => {
    const buf = new ArrayBuffer(84 + 50);
    const view = new DataView(buf);
    view.setUint32(80, 1, true);
    [1, 2, 3, 4, 5, 6, 7, 8, 9].forEach((v, i) => { view.setFloat32(84 + 12 + i * 4, v, true); });
    expect(isBinaryStl(buf)).toBe(true);
    expect([...parseStl(buf)]).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
  });

  it('reads ASCII STL', () => {
    const text = 'solid x\nfacet normal 0 0 1\nouter loop\nvertex 0 0 0\nvertex 1 0 0\nvertex 0 1 0\nendloop\nendfacet\nendsolid';
    expect([...parseStl(new TextEncoder().encode(text).buffer as ArrayBuffer)]).toEqual([0, 0, 0, 1, 0, 0, 0, 1, 0]);
  });

  it('rejects a file that is not an STL instead of returning an empty mesh', () => {
    expect(() => parseStl(new TextEncoder().encode('hello').buffer as ArrayBuffer)).toThrow();
  });
});
