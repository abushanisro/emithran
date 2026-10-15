import { decodeJwtPayload } from '../supabase/jwt-payload';

/**
 * The inactivity-timeout rule, in one place.
 *
 * A session stays alive for IDLE_TIMEOUT_MS after the user's last real
 * activity. While one of the protected CAD/BOM flows is running, each job
 * heartbeat keeps it alive JOB_GRACE_MS longer, but never past
 * JOB_EXTENSION_MAX_MS beyond the idle deadline. Every input only ever moves
 * forward, so the deadline only ever moves forward too.
 *
 * The browser reads these values from GET /v1/api/auth/session instead of
 * keeping its own copy, so the countdown can never drift from what the server
 * enforces.
 */
export const SESSION_IDLE_POLICY = {
  idleTimeoutMs: 30 * 60_000,
  warningMs: 2 * 60_000,
  jobExtensionMaxMs: 15 * 60_000,
  jobGraceMs: 2 * 60_000,
} as const;

export type SessionIdlePolicy = { [K in keyof typeof SESSION_IDLE_POLICY]: number };

export interface SessionActivityTimes {
  /** Last user-activity heartbeat, ms since epoch. */
  lastActivityAt: number;
  /** Last protected-job heartbeat, ms since epoch, or null if none. */
  lastJobAt: number | null;
}

export function sessionDeadline(
  { lastActivityAt, lastJobAt }: SessionActivityTimes,
  policy: SessionIdlePolicy = SESSION_IDLE_POLICY,
): number {
  const idleDeadline = lastActivityAt + policy.idleTimeoutMs;
  if (lastJobAt === null) return idleDeadline;
  const jobDeadline = Math.min(lastJobAt + policy.jobGraceMs, idleDeadline + policy.jobExtensionMaxMs);
  return Math.max(idleDeadline, jobDeadline);
}

/** The Supabase session id carried in an access token's claims, or null. */
export function sessionIdFromAccessToken(token: string): string | null {
  const sessionId = decodeJwtPayload(token)?.session_id;
  return typeof sessionId === 'string' && sessionId ? sessionId : null;
}
