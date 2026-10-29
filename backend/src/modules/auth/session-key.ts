import { createHash } from 'node:crypto';

/**
 * Auth0's `sid` is an opaque string; the inactivity table (migration 901) keys on a uuid. The same sid always gives the same uuid
 * (a version-5-style hash, namespaced so it can never equal a Supabase session id), so no table change is needed.
 */
export function sessionKeyFromAuth0Sid(sid: string): string {
  const h = createHash('sha256').update(`emithran:auth0:${sid}`).digest();
  h[6] = (h[6] & 0x0f) | 0x50;
  h[8] = (h[8] & 0x3f) | 0x80;
  const x = h.subarray(0, 16).toString('hex');
  return `${x.slice(0, 8)}-${x.slice(8, 12)}-${x.slice(12, 16)}-${x.slice(16, 20)}-${x.slice(20, 32)}`;
}
