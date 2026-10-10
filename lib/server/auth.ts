import { NextResponse } from 'next/server';

import { createServerSupabaseClient } from '@/lib/database/supabase-server';
import { checkRateLimit } from '@/lib/server/rate-limit';

export type AuthResult = { ok: true; userId: string } | { ok: false; response: NextResponse };

/**
 * The signed-in user behind this request, verified with Supabase (getUser asks
 * the auth server; it does not trust the cookie's contents). Routes that spend
 * money (AI) or fetch on the caller's behalf call this first.
 */
export async function requireUser(): Promise<AuthResult> {
  try {
    const supabase = await createServerSupabaseClient();
    const { data, error } = await supabase.auth.getUser();
    if (error || !data.user) {
      return { ok: false, response: NextResponse.json({ error: 'Authentication required' }, { status: 401 }) };
    }
    return { ok: true, userId: data.user.id };
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
