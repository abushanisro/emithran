/**
 * Loads a part's triangle mesh once and shares it: concurrent requests for the
 * same part wait on one load, finished meshes stay in a byte-bounded LRU, and a
 * mesh is only evicted when nothing holds it. Keyed by storage path, because
 * the signed URL's token changes every minute.
 *
 * The fetch and the parse are injected (see viewerGeometryStore for the real
 * ones), so the cache logic is testable without a network or a worker.
 */
export interface LoadedMesh {
  positions: Float32Array;
  triTotal: number;
}

export interface MeshHandle {
  mesh: LoadedMesh;
  /** Give the mesh back; an unreferenced mesh becomes evictable. Safe to call twice. */
  release: () => void;
}

interface Entry {
  mesh: LoadedMesh;
  bytes: number;
  holders: number;
}

export interface GeometryStoreOptions {
  maxBytes: number;
  fetchBuffer: (url: string) => Promise<ArrayBuffer>;
  parse: (buffer: ArrayBuffer) => Promise<Float32Array>;
}

/** Storage path without the signed query string. */
export function storageKey(url: string): string {
  try {
    return new URL(url, 'http://local').pathname;
  } catch {
    return url.split('?')[0] ?? url;
  }
}

export class GeometryStore {
  private readonly entries = new Map<string, Entry>(); // insertion order = LRU order
  private readonly loading = new Map<string, Promise<Entry>>();
  private bytes = 0;

  constructor(private readonly opts: GeometryStoreOptions) {}

  async acquire(url: string): Promise<MeshHandle> {
    const key = storageKey(url);
    let entry = this.entries.get(key);
    if (entry) {
      this.entries.delete(key); // refresh recency
      this.entries.set(key, entry);
    } else {
      let pending = this.loading.get(key);
      if (!pending) {
        pending = this.load(url).finally(() => { this.loading.delete(key); });
        this.loading.set(key, pending);
      }
      entry = await pending;
      if (!this.entries.has(key)) {
        this.entries.set(key, entry);
        this.bytes += entry.bytes;
      }
    }
    entry.holders += 1;
    this.evict(key);
    let released = false;
    const held = entry;
    return {
      mesh: held.mesh,
      release: () => {
        if (released) return;
        released = true;
        held.holders -= 1;
        this.evict();
      },
    };
  }

  private async load(url: string): Promise<Entry> {
    const buffer = await this.opts.fetchBuffer(url);
    const positions = await this.opts.parse(buffer);
    return { mesh: { positions, triTotal: positions.length / 9 }, bytes: positions.byteLength, holders: 0 };
  }

  /** Drop least-recently-used unreferenced meshes until under budget. `keep` is never dropped. */
  private evict(keep?: string): void {
    for (const [key, entry] of this.entries) {
      if (this.bytes <= this.opts.maxBytes) break;
      if (entry.holders > 0 || key === keep) continue;
      this.entries.delete(key);
      this.bytes -= entry.bytes;
    }
  }

  /** Test/diagnostic view. */
  stats(): { entries: number; bytes: number } {
    return { entries: this.entries.size, bytes: this.bytes };
  }
}
