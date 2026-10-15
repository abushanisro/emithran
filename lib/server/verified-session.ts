import { createHash } from 'node:crypto';

import { jwtExpiryMs } from '@/lib/auth/jwt-payload';

import type { SupabaseClient, User } from '@supabase/supabase-js';

/**
 * The caller's session, confirmed with Supabase Auth at most once a minute per
 * token.
 *
 * Every getUser() is a request to Supabase Auth and a line against the
 * project's log quota, and API routes such as the PDF file proxy run on every
 * view. A confirmed token is trusted for TTL_MS, never past its own expiry, so
 * a session signed out elsewhere can keep working here for up to a minute. The
 * inactivity timeout is still checked on every call (checkSessionActive), and
 * the backend drops a timed-out session at once.
 */
const TTL_MS = 60_000;
const MAX_ENTRIES = 5_000;

const confirmed = new Map<string, { user: User; until: number }>();

const keyOf = (token: string) => createHash('sha256').update(token).digest('hex');

/** The two Auth calls used, so any Supabase client (browser, ssr, test fake) fits. */
export interface SessionAuth {
  auth: Pick<SupabaseClient['auth'], 'getSession' | 'getUser'>;
}

export async function verifiedSession(
  supabase: SessionAuth,
  now = Date.now(),
): Promise<{ user: User; accessToken: string } | null> {
  // Reads the session cookie locally (refreshing it only if expired).
  const { data: { session } } = await supabase.auth.getSession();
  const accessToken = session?.access_token;
  if (!accessToken) return null;

  const key = keyOf(accessToken);
  const hit = confirmed.get(key);
  if (hit && hit.until > now) return { user: hit.user, accessToken };

  // Confirmed with the Auth server: a forged or revoked token is rejected here.
  const { data: { user }, error } = await supabase.auth.getUser(accessToken);
  if (error || !user) {
    confirmed.delete(key);
    return null;
  }
  const until = Math.min(now + TTL_MS, jwtExpiryMs(accessToken) ?? now + TTL_MS);
  if (until > now) {
    // Drop the oldest entry rather than everything, so a burst of new
    // sessions never sends every other caller back to Supabase Auth at once.
    if (confirmed.size >= MAX_ENTRIES) {
      const oldest = confirmed.keys().next().value;
      if (oldest !== undefined) confirmed.delete(oldest);
    }
    confirmed.set(key, { user, until });
  }
  return { user, accessToken };
}

/** Tests only. */
export function clearVerifiedSessions(): void {
  confirmed.clear();
}
