/**
 * Short-lived memoisation for reads of GLOBAL reference data (the sm_lookup_*
 * tables): the same arguments give the same rows for everyone, and the tables
 * change only by migration.
 *
 * Rules that keep it safe:
 *  - concurrent identical calls share one in-flight load;
 *  - only POSITIVE results are kept (found rows, non-empty collections). A miss,
 *    an empty result or a thrown error is never stored, so a transient database
 *    error can never turn into a remembered "no data";
 *  - every caller gets its own copy, so one caller cannot alter what another sees;
 *  - entries expire after a TTL and the store is bounded;
 *  - the key is the method name plus every argument, so nothing that affects the
 *    result is left out.
 *
 * Use it only on methods whose result depends on their arguments and on global
 * reference tables, never on the caller, an organization or a request.
 */

export interface MemoOptions {
  ttlMs: number;
  maxEntries: number;
  now?: () => number;
}

interface Entry {
  value: unknown;
  expiresAt: number;
}

/** Whether a result is worth remembering: found data, never a miss or an empty answer. */
const tag = (v: unknown) => Object.prototype.toString.call(v);

export function isCacheable(value: unknown): boolean {
  if (value === null || value === undefined) return false;
  // tag check, not instanceof: a structuredClone copy can come from another realm
  if (tag(value) === '[object Map]' || tag(value) === '[object Set]') return (value as Map<unknown, unknown>).size > 0;
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === 'object' && 'dataFound' in (value as object)) {
    const found = (value as { dataFound: unknown }).dataFound;
    if (tag(found) === '[object Set]') return (found as Set<unknown>).size > 0;
    return found === true;
  }
  return true;
}

const copy = <T>(v: T): T => (v !== null && typeof v === 'object' ? structuredClone(v) : v);

export class TtlMemo {
  private readonly entries = new Map<string, Entry>(); // insertion order = recency
  private readonly inflight = new Map<string, Promise<unknown>>();
  private readonly now: () => number;

  constructor(private readonly opts: MemoOptions) {
    this.now = opts.now ?? Date.now;
  }

  async get<T>(key: string, load: () => Promise<T>, cacheable: (v: unknown) => boolean = isCacheable): Promise<T> {
    const hit = this.entries.get(key);
    if (hit && hit.expiresAt > this.now()) {
      this.entries.delete(key);
      this.entries.set(key, hit); // refresh recency
      return copy(hit.value as T);
    }
    if (hit) this.entries.delete(key);

    let pending = this.inflight.get(key) as Promise<T> | undefined;
    if (!pending) {
      pending = load().then((value) => {
        if (cacheable(value)) this.store(key, value);
        return value;
      }).finally(() => { this.inflight.delete(key); });
      this.inflight.set(key, pending);
    }
    return copy(await pending);
  }

  private store(key: string, value: unknown): void {
    this.entries.set(key, { value: copy(value), expiresAt: this.now() + this.opts.ttlMs });
    while (this.entries.size > this.opts.maxEntries) {
      const oldest = this.entries.keys().next().value as string;
      this.entries.delete(oldest);
    }
  }

  clear(): void {
    this.entries.clear();
  }

  get size(): number {
    return this.entries.size;
  }
}

function stableKey(args: unknown[]): string {
  return JSON.stringify(args, (_k, v) => (tag(v) === '[object Map]' || tag(v) === '[object Set]' ? [...(v as Iterable<unknown>)] : v));
}

const DEFAULT_TTL_MS = Number(process.env.REFERENCE_CACHE_TTL_MS ?? 5 * 60 * 1000);
const DISABLED = process.env.REFERENCE_CACHE_DISABLED === '1';
const stores = new WeakMap<object, TtlMemo>();

/** Method decorator: memoise an async reference-data read per instance. */
export function ReferenceMemo(options: { cacheable?: (value: unknown) => boolean } = {}): MethodDecorator {
  return (_target, propertyKey, descriptor: PropertyDescriptor) => {
    const original = descriptor.value as (...args: unknown[]) => Promise<unknown>;
    descriptor.value = function (this: object, ...args: unknown[]) {
      if (DISABLED) return original.apply(this, args);
      let memo = stores.get(this);
      if (!memo) {
        memo = new TtlMemo({ ttlMs: DEFAULT_TTL_MS, maxEntries: 500 });
        stores.set(this, memo);
      }
      return memo.get(`${String(propertyKey)}:${stableKey(args)}`, () => original.apply(this, args), options.cacheable);
    };
    return descriptor;
  };
}
