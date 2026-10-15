import { evictOldestIfFull } from '../../../common/cache/bounded-map';

/**
 * Signed Storage links reused while they still have plenty of life left.
 *
 * Every createSignedUrl() returns a new token, so the browser could never
 * cache a file it had already downloaded: each view of a model or drawing was
 * a fresh download, billed as Supabase egress. Handing out the same link again
 * lets the browser's HTTP cache (Supabase serves objects with max-age=3600)
 * answer repeat views.
 *
 * A link is reused only until REUSE_MARGIN_SEC before it expires, so whoever
 * receives it still has at least that long to open it.
 */
export const SIGNED_URL_TTL_SEC = 3600;
const REUSE_MARGIN_SEC = 10 * 60;
const MAX_ENTRIES = 5_000;

const links = new Map<string, { url: string; reuseUntil: number }>();

export function getReusableSignedUrl(key: string, now = Date.now()): string | undefined {
  const entry = links.get(key);
  if (!entry) return undefined;
  if (entry.reuseUntil <= now) {
    links.delete(key);
    return undefined;
  }
  return entry.url;
}

export function rememberSignedUrl(key: string, url: string, ttlSec: number, now = Date.now()): void {
  const reuseUntil = now + Math.max(0, ttlSec - REUSE_MARGIN_SEC) * 1000;
  if (reuseUntil <= now) return;
  evictOldestIfFull(links, MAX_ENTRIES);
  links.set(key, { url, reuseUntil });
}

/** Tests only. */
export function clearSignedUrls(): void {
  links.clear();
}
