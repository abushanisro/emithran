import { NextResponse } from 'next/server';

import { SESSION_IDLE_TIMEOUT_CODE } from '@/lib/auth/session-idle/policy';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { checkRateLimit } from '@/lib/server/rate-limit';
import { checkSessionActive } from '@/lib/server/session-idle-check';
import { verifiedSession } from '@/lib/server/verified-session';

export type AuthResult =
  | { ok: true; userId: string; accessToken: string }
  | { ok: false; response: NextResponse };

/**
 * The signed-in user behind this request, verified with Supabase (getUser asks
 * the auth server, at most once a minute per token; see verified-session.ts)
 * and inside its inactivity deadline. Routes that spend money (AI) or fetch on
 * the caller's behalf call this first.
 */
export async function requireUser(): Promise<AuthResult> {
  try {
    const verified = await verifiedSession(await createServerSupabaseClient());
    if (!verified) {
      return { ok: false, response: NextResponse.json({ error: 'Authentication required' }, { status: 401 }) };
    }
    const check = await checkSessionActive(verified.accessToken);
    if (check === 'unavailable') {
      return { ok: false, response: NextResponse.json({ error: 'Session check unavailable' }, { status: 503 }) };
    }
    if (check !== 'active') {
      return {
        ok: false,
        response: NextResponse.json(
          { error: 'Authentication required', ...(check === 'idle' && { code: SESSION_IDLE_TIMEOUT_CODE }) },
          { status: 401 },
        ),
      };
    }
    return { ok: true, userId: verified.user.id, accessToken: verified.accessToken };
  } catch {
    return { ok: false, response: NextResponse.json({ error: 'Authentication required' }, { status: 401 }) };
  }
}

const AI_LIMIT_PER_MINUTE = Number(process.env.AI_ROUTE_LIMIT_PER_MINUTE ?? 20);

/** requireUser plus a per-user cap on paid AI calls. */
export async function requireUserForAi(route: string): Promise<AuthResult> {
  const auth = await requireUser();
  if (!auth.ok) return auth;
  const limit = checkRateLimit(`${route}:${auth.userId}`, AI_LIMIT_PER_MINUTE, 60_000);
  if (!limit.allowed) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: 'Too many requests' },
        { status: 429, headers: { 'Retry-After': String(limit.retryAfterSec) } },
      ),
    };
  }
  return auth;
}
