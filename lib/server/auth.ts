import { NextResponse } from 'next/server';

import { SESSION_IDLE_TIMEOUT_CODE } from '@/lib/auth/session-idle/policy';
import { getAuth0 } from '@/lib/auth0';
import { resolveAuth0Caller } from '@/lib/server/auth0-caller';
import { checkRateLimit } from '@/lib/server/rate-limit';

export type AuthResult =
  | { ok: true; userId: string; accessToken: string }
  | { ok: false; response: NextResponse };

const refuse = (error: string, status: number, code?: string): AuthResult => ({ ok: false, response: NextResponse.json({ error, ...(code && { code }) }, { status }) });

/**
 * The signed-in user behind this request. The Auth0 session gives the API token; the backend verifies it and enforces invitation and the
 * inactivity deadline. Routes that spend money (AI) or fetch on the caller's behalf call this first.
 */
export async function requireUser(): Promise<AuthResult> {
  let accessToken: string;
  try {
    accessToken = (await getAuth0().getAccessToken()).token;
  } catch {
    return refuse('Authentication required', 401);
  }
  const caller = await resolveAuth0Caller(accessToken);
  switch (caller.status) {
    case 'ok': return { ok: true, userId: caller.userId, accessToken };
    case 'idle': return refuse('Authentication required', 401, SESSION_IDLE_TIMEOUT_CODE);
    case 'forbidden': return refuse('Access denied', 403);
    case 'unavailable': return refuse('Session check unavailable', 503);
    default: return refuse('Authentication required', 401);
  }
}

/**
 * The API access token of this request's session, or null when signed out. Nothing is verified here: the API verifies the token and
 * enforces invitation and the idle deadline on every call, so the BFF does not pay for a second check.
 */
export async function sessionAccessToken(): Promise<string | null> {
  try {
    return (await getAuth0().getAccessToken()).token;
  } catch {
    return null;
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
