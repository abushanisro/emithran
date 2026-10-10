import { GeometryStore } from './geometry-store';
import { parseStl } from './stl-parse';

/** Cache budget for loaded meshes (megabytes of triangle positions); override per deployment. */
const MAX_CACHE_MB = Number(process.env.NEXT_PUBLIC_VIEWER_CACHE_MB ?? 256);

type Pending = { resolve: (p: Float32Array) => void; reject: (e: Error) => void };

let worker: Worker | null | undefined; // undefined = not tried yet, null = unavailable
let nextId = 1;
const pending = new Map<number, Pending>();

function getWorker(): Worker | null {
  if (worker !== undefined) return worker;
  try {
    const w = new Worker(new URL('./stl-parse.worker.ts', import.meta.url));
    w.onmessage = (e: MessageEvent<{ id: number; positions?: Float32Array; error?: string }>) => {
      const p = pending.get(e.data.id);
      if (!p) return;
      pending.delete(e.data.id);
      if (e.data.positions) p.resolve(e.data.positions);
      else p.reject(new Error(e.data.error ?? 'STL parse failed'));
    };
    w.onerror = () => {
      // The worker itself broke: fail what it held, and parse on the main thread from now on.
      for (const p of pending.values()) p.reject(new Error('STL worker failed'));
      pending.clear();
      worker = null;
    };
    worker = w;
  } catch {
    worker = null;
  }
  return worker;
}

/** Parse off the main thread when a worker is available, else on it. The buffer is transferred, not copied. */
function parse(buffer: ArrayBuffer): Promise<Float32Array> {
  const w = getWorker();
  if (!w) return Promise.resolve(parseStl(buffer));
  return new Promise((resolve, reject) => {
    const id = nextId++;
    pending.set(id, { resolve, reject });
    w.postMessage({ id, buffer }, [buffer]);
  });
}

async function fetchBuffer(url: string): Promise<ArrayBuffer> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Model download failed (${response.status})`);
  return response.arrayBuffer();
}

/** The one shared mesh cache for every viewer that wants it. */
export const viewerGeometryStore = new GeometryStore({
  maxBytes: MAX_CACHE_MB * 1024 * 1024,
  fetchBuffer,
  parse,
});
