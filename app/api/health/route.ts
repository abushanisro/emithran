import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

/**
 * The browser's connectivity check (lib/api/health-check.ts) calls GET <origin>/api/health. On the public origin only the frontend answers
 * (the tunnel sends /v1/* to the API and everything else here), so without this route the check got a 404, the app never counted the
 * backend as reachable, and every readiness-gated query (the BOM lists, for one) stayed switched off.
 *
 * Public and unauthenticated by design: it returns only ok/unavailable. It asks the API's liveness endpoint over the internal network and
 * remembers the answer for a few seconds, so many open tabs cannot turn into many calls to the API.
 */
const TIMEOUT_MS = 2_000;
const REMEMBER_MS = 5_000;

// The newest answer, or the probe still under way, so callers arriving together share one call.
let last: { at: number; ok: Promise<boolean> } | null = null;

async function apiIsAlive(): Promise<boolean> {
  const api = process.env.API_URL ?? process.env.NEXT_PUBLIC_API_URL;
  if (!api) return false;
  try {
    const res = await fetch(`${new URL(api).origin}/api/health/live`, { cache: 'no-store', signal: AbortSignal.timeout(TIMEOUT_MS) });
    return res.ok;
  } catch {
    return false;
  }
}

export async function GET(): Promise<Response> {
  const now = Date.now();
  if (!last || now - last.at >= REMEMBER_MS) last = { at: now, ok: apiIsAlive() };
  const ok = await last.ok;
  return NextResponse.json({ status: ok ? 'ok' : 'unavailable' }, { status: ok ? 200 : 503, headers: { 'cache-control': 'no-store' } });
}
