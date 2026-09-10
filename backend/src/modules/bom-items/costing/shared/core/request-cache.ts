import { AsyncLocalStorage } from 'node:async_hooks';

/**
 * A read cache whose lifetime is exactly ONE request.
 *
 * Why (measured 2026-09-09, not assumed): one getCostSummary call on a real
 * SECC part took 12.4s, of which essentially all was PostgREST round trips --
 * 66 outbound calls, no CPU hot spot, 250-500ms each against the hosted
 * database. The largest component was the same static catalog rows being
 * re-read once per operation in the route:
 *
 *   process_calculator_mappings   10 calls   2546 ms
 *   calculators                   10 calls   2180 ms
 *   calculator_fields              5 calls   1074 ms
 *
 * resolvePhysicsQuantity issues three of those per operation, so a ten-operation
 * route pays for the same catalog ten times.
 *
 * Request-scoped, NOT a TTL cache: these are catalog tables that migrations
 * change (714 and 715 both rewrote process_calculator_mappings), and a
 * time-based cache would keep serving the pre-migration catalog until it
 * expired. One request means a catalog change is visible on the next request,
 * with no invalidation to get wrong. It is also single-tenant by construction --
 * one request is one access token -- so a cached row cannot cross an RLS
 * boundary.
 *
 * Constraint for new call sites: only cache a read whose table this same
 * request does not write and then re-read. All current keys are catalog reads
 * on paths that never write those tables.
 */

/**
 * Promises, not resolved values, so two concurrent readers of one key share a
 * single in-flight round trip.
 */
const storage = new AsyncLocalStorage<Map<string, Promise<unknown>>>();

/**
 * Runs `fn` with a cache in scope, reusing an outer scope if one exists.
 *
 * Generic over the return type rather than Promise-specific because the
 * interceptor needs to establish the scope around a synchronous
 * `subscribe()` call, not around a promise.
 */
export function runWithRequestCache<T>(fn: () => T): T {
  return storage.getStore() ? fn() : storage.run(new Map(), fn);
}

/**
 * Reads through the request cache when one is in scope, straight through when
 * not. The straight-through path is what makes adding this to a query a local
 * change: a call site reached outside a request stays correct, it just does not
 * get the saving.
 *
 * A rejected load is evicted so a transient failure is retried by the next
 * reader rather than cached as a failure.
 */
export function cachedRead<T>(key: string, load: () => Promise<T>): Promise<T> {
  const cache = storage.getStore();
  if (!cache) return load();

  const hit = cache.get(key);
  if (hit) return hit as Promise<T>;

  const pending = load().catch((err) => {
    cache.delete(key);
    throw err;
  });
  cache.set(key, pending);
  return pending;
}
