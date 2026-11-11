import { healthAnswer } from '@/lib/server/health-probe';

export const dynamic = 'force-dynamic';

/** What an outside uptime monitor watches: 200 only while the API, the database and both engines answer (lib/server/health-probe.ts). */
export async function GET(): Promise<Response> {
  return healthAnswer('ready');
}
