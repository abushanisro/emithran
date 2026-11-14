import { healthAnswer } from '@/lib/server/health-probe';

export const dynamic = 'force-dynamic';

/**
 * The browser's connectivity check (lib/api/health-check.ts) calls GET <origin>/api/health. On the public origin only the frontend answers (the tunnel
 * sends /v1/* to the API and everything else here), so without this route the check got a 404, the app never counted the backend as reachable, and every
 * readiness-gated query (the BOM lists, for one) stayed switched off. See lib/server/health-probe.ts.
 */
export async function GET(): Promise<Response> {
  return healthAnswer('live');
}
