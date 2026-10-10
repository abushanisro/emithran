/**
 * Fixed-window per-key rate limit for Next route handlers (paid AI calls).
 * In memory, so each server instance counts for itself: it bounds a single
 * signed-in user's spend per instance; a shared store would be needed for an
 * exact global limit. Expired windows are dropped as they are touched.
 */
const windows = new Map<string, { count: number; resetAt: number }>();
const MAX_KEYS = 10_000;

export function checkRateLimit(
  key: string,
  limit: number,
  windowMs: number,
  now: number = Date.now(),
): { allowed: boolean; retryAfterSec: number } {
  const w = windows.get(key);
  if (!w || w.resetAt <= now) {
    if (windows.size >= MAX_KEYS) {
      for (const [k, v] of windows) if (v.resetAt <= now) windows.delete(k);
      if (windows.size >= MAX_KEYS) windows.clear(); // pathological: start over rather than grow without bound
    }
    windows.set(key, { count: 1, resetAt: now + windowMs });
    return { allowed: true, retryAfterSec: 0 };
  }
  if (w.count >= limit) return { allowed: false, retryAfterSec: Math.ceil((w.resetAt - now) / 1000) };
  w.count += 1;
  return { allowed: true, retryAfterSec: 0 };
}

/** Test helper. */
export function resetRateLimits(): void {
  windows.clear();
}
