import { createHash } from 'node:crypto';
import { evictOldestIfFull } from '../cache/bounded-map';
import { jwtExpiryMs } from './jwt-payload';

/**
 * Short-lived memory of tokens Supabase Auth has already confirmed.
 *
 * Without it the guard asked Supabase Auth (GET /auth/v1/user) on every single
 * API request: one Auth request, and one log line against the project's log
 * quota, per call. A confirmed token is now trusted for TTL_MS, never past its
 * own expiry.
 *
 * Trade-off: a session signed out elsewhere keeps working here for up to
 * TTL_MS. A session ended by the inactivity timeout does not: it is dropped
 * from this cache (forget) at the moment it is revoked, and the idle check runs
 * on every request regardless.
 *
 * Module-level on purpose: SupabaseService is instantiated once per Nest module
 * that provides it, so an instance field would give each module its own cache
 * and forget() would miss the guard's copy.
 */
const TTL_MS = 60_000;
const MAX_ENTRIES = 10_000;

interface Entry<T> {
  value: T;
  until: number;
}

const entries = new Map<string, Entry<unknown>>();

const keyOf = (token: string) => createHash('sha256').update(token).digest('hex');

export function getVerified<T>(token: string, now = Date.now()): T | undefined {
  const key = keyOf(token);
  const entry = entries.get(key);
  if (!entry) return undefined;
  if (entry.until <= now) {
    entries.delete(key);
    return undefined;
  }
  return entry.value as T;
}

export function rememberVerified<T>(token: string, value: T, now = Date.now()): void {
  const until = Math.min(now + TTL_MS, jwtExpiryMs(token) ?? now + TTL_MS);
  if (until <= now) return;
  evictOldestIfFull(entries, MAX_ENTRIES);
  entries.set(keyOf(token), { value, until });
}

export function forgetVerified(token: string): void {
  entries.delete(keyOf(token));
}

/** Tests only. */
export function clearVerifiedTokens(): void {
  entries.clear();
}
