import { createHash } from 'node:crypto';

import { apiConfig } from '@/lib/api/config';
import { SESSION_IDLE_TIMEOUT_CODE } from '@/lib/auth/session-idle/policy';

export type SessionCheck = 'active' | 'idle' | 'invalid' | 'unavailable';

/** How long an "active" answer is reused, at most (and never past the deadline). */
const ACTIVE_TTL_MS = 30_000;
const MAX_ENTRIES = 5_000;

const activeUntil = new Map<string, number>();

const keyOf = (token: string) => createHash('sha256').update(token).digest('hex');

interface StatusBody {
  data?: { deadline?: number | null };
  error?: { code?: string };
}

/**
 * Asks the backend whether this session is still inside its inactivity
 * deadline. Next.js API routes verify the cookie with Supabase themselves and
 * never pass through the NestJS guard, so without this an idle session's
 * cookie would keep working here. The backend stays the one place the
 * timeout is decided. This check does not count as activity.
 *
 * An "active" answer is reused for up to ACTIVE_TTL_MS, and never past the
 * deadline the backend reported, so a route like the PDF file proxy does not
 * wait on a backend round trip for every view. Any other answer is never
 * reused.
 */
export async function checkSessionActive(accessToken: string, now = Date.now()): Promise<SessionCheck> {
  const key = keyOf(accessToken);
  const until = activeUntil.get(key);
  if (until !== undefined) {
    if (until > now) return 'active';
    activeUntil.delete(key);
  }

  try {
    const res = await fetch(`${apiConfig.endpoints.api.v1}/auth/session`, {
      headers: { Authorization: `Bearer ${accessToken}` },
      cache: 'no-store',
      signal: AbortSignal.timeout(5_000),
    });
    const body = (await res.json().catch(() => null)) as StatusBody | null;
    if (res.ok) {
      remember(key, now, body?.data?.deadline ?? null);
      return 'active';
    }
    if (res.status === 401) {
      return body?.error?.code === SESSION_IDLE_TIMEOUT_CODE ? 'idle' : 'invalid';
    }
    return 'unavailable';
  } catch {
    return 'unavailable';
  }
}

function remember(key: string, now: number, deadline: number | null): void {
  const until = Math.min(now + ACTIVE_TTL_MS, deadline ?? now + ACTIVE_TTL_MS);
  if (until <= now) return;
  // Evict the oldest entry rather than everything, so a burst of new
  // sessions never sends every other caller back to the backend at once.
  if (activeUntil.size >= MAX_ENTRIES) {
    const oldest = activeUntil.keys().next().value;
    if (oldest !== undefined) activeUntil.delete(oldest);
  }
  activeUntil.set(key, until);
}

/** Tests only. */
export function clearSessionChecks(): void {
  activeUntil.clear();
}
