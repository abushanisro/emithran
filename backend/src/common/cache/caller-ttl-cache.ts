/**
 * A short-lived cache of read results, kept per CALLER.
 *
 * Why per caller: the database decides what each user may see (row-level security), so two users asking the same question can get different
 * answers. The key therefore contains the caller's identity (the `sub` claim of the access token, which the auth guard has already verified); a
 * token whose identity cannot be read is never cached, and one caller can never be served another caller's entry.
 *
 * Why it exists: some reference lists (the distinct currencies, locations and process groups of the machine rates) were computed by downloading
 * every row (PostgREST answers 1,000 rows at most, so 7 sequential round trips for 6,472 rows) and removing duplicates in JavaScript, for every
 * request. The data changes rarely and is identical between page loads; on a small server that was most of the work of the Machine Rates page.
 *
 * Behaviour: entries live `ttlMs`; callers that arrive while a load is running share it (one database read, not ten); a failed load is not
 * kept; the map is bounded and drops the oldest entry first; `clear()` (or the ClearsCallerCache decorator on writers) empties it.
 */
export class CallerTtlCache {
  private readonly entries = new Map<string, { at: number; value: Promise<unknown> }>();

  constructor(
    private readonly ttlMs: number,
    private readonly maxEntries = 500,
    private readonly now: () => number = Date.now,
  ) {}

  /** The caller named by the token's `sub` claim, or null when the token cannot be read (such a call bypasses the cache). */
  static callerOf(accessToken: string): string | null {
    const part = accessToken.split('.')[1];
    if (!part) return null;
    try {
      const sub = (JSON.parse(Buffer.from(part, 'base64url').toString('utf8')) as { sub?: unknown }).sub;
      return typeof sub === 'string' && sub.length > 0 ? sub : null;
    } catch {
      return null;
    }
  }

  async get<T>(accessToken: string, name: string, load: () => Promise<T>): Promise<T> {
    const caller = CallerTtlCache.callerOf(accessToken);
    if (!caller) return load();
    const key = `${caller}\u0000${name}`;
    const hit = this.entries.get(key);
    if (hit && this.now() - hit.at < this.ttlMs) return hit.value as Promise<T>;
    const value = load();
    this.entries.set(key, { at: this.now(), value });
    if (this.entries.size > this.maxEntries) this.entries.delete(this.entries.keys().next().value as string);
    try {
      return await value;
    } catch (error) {
      if (this.entries.get(key)?.value === value) this.entries.delete(key); // a failed read is never remembered
      throw error;
    }
  }

  clear(): void {
    this.entries.clear();
  }
}

/** Empties the named CallerTtlCache field of the instance after the method finishes, whether it succeeded or not: a write may have partly happened. */
export function ClearsCallerCache(field: string): MethodDecorator {
  return (_target, _key, descriptor: PropertyDescriptor) => {
    const original = descriptor.value as (...args: unknown[]) => Promise<unknown>;
    descriptor.value = async function (this: Record<string, CallerTtlCache>, ...args: unknown[]) {
      try {
        return await original.apply(this, args);
      } finally {
        this[field].clear();
      }
    };
  };
}
