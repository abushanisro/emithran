import { NextResponse } from 'next/server';

/**
 * The public health answers (GET /api/health and GET /api/health/ready), for the browser's connectivity check and for outside uptime monitors.
 *
 * Public and unauthenticated by design: each returns only ok / unavailable, no version and no detail. Each asks the API over the internal network and
 * remembers the answer for a few seconds, so many tabs or monitors cannot turn into many calls to the API (and, for `ready`, to the database and the engines).
 *
 *   live   the API process answers (what the browser needs to treat the backend as reachable)
 *   ready  the API process, the database and both engines answer (what an uptime monitor should watch: a down database or engine makes the site unusable
 *          while the process itself is still alive)
 */
export type HealthKind = 'live' | 'ready';

const SETTINGS: Record<HealthKind, { path: string; timeoutMs: number; rememberMs: number }> = {
  live: { path: '/api/health/live', timeoutMs: 2_000, rememberMs: 5_000 },
  ready: { path: '/api/health/ready', timeoutMs: 8_000, rememberMs: 10_000 },
};

// The newest answer per kind, or the probe still under way, so callers arriving together share one call.
const last: Partial<Record<HealthKind, { at: number; ok: Promise<boolean> }>> = {};

async function apiAnswers(kind: HealthKind): Promise<boolean> {
  const api = process.env.API_URL ?? process.env.NEXT_PUBLIC_API_URL;
  if (!api) return false;
  const { path, timeoutMs } = SETTINGS[kind];
  try {
    const res = await fetch(`${new URL(api).origin}${path}`, { cache: 'no-store', signal: AbortSignal.timeout(timeoutMs) });
    return res.ok;
  } catch {
    return false;
  }
}

export async function healthAnswer(kind: HealthKind): Promise<Response> {
  const now = Date.now();
  const known = last[kind];
  const entry = known && now - known.at < SETTINGS[kind].rememberMs ? known : { at: now, ok: apiAnswers(kind) };
  last[kind] = entry;
  const ok = await entry.ok;
  return NextResponse.json({ status: ok ? 'ok' : 'unavailable' }, { status: ok ? 200 : 503, headers: { 'cache-control': 'no-store' } });
}
