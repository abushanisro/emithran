/**
 * Runs `fn` unless a previous call is still in flight, in which case the new call
 * is ignored (not queued) and resolves to undefined. The guard is released when the
 * running call settles, whether it resolved or threw, so a failed run never leaves
 * the action locked.
 *
 * Use it for user-triggered writes (Apply): a double click, a second tab of the same
 * handler, or a re-render that re-invokes the handler must not run it twice.
 */
export function createSingleFlight(): <T>(fn: () => Promise<T>) => Promise<T | undefined> {
  let inFlight = false;
  return async <T>(fn: () => Promise<T>): Promise<T | undefined> => {
    if (inFlight) return undefined;
    inFlight = true;
    try {
      return await fn();
    } finally {
      inFlight = false;
    }
  };
}
