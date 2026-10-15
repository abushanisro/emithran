import { decodeJwtPayload } from '../jwt-payload';

/**
 * Inactivity-timeout rule, browser side.
 *
 * The server (backend/src/common/session/session-idle-policy.ts) is the
 * authority: it enforces the timeout and returns these values from
 * GET /auth/session, which the controller adopts. DEFAULT_SESSION_IDLE_POLICY
 * only covers the moment before that first answer arrives.
 */
export interface SessionIdlePolicy {
  idleTimeoutMs: number;
  warningMs: number;
  jobExtensionMaxMs: number;
  jobGraceMs: number;
}

export const DEFAULT_SESSION_IDLE_POLICY: SessionIdlePolicy = {
  idleTimeoutMs: 30 * 60_000,
  warningMs: 2 * 60_000,
  jobExtensionMaxMs: 15 * 60_000,
  jobGraceMs: 2 * 60_000,
};

/**
 * How often user activity is reported to the server, at most. Every report is
 * a request against the Supabase log quota, and the server deadline is 30
 * minutes away, so once per 5 minutes is plenty: the report that follows any
 * activity always arrives long before that deadline, and "Stay signed in" is
 * reported at once.
 */
export const USER_HEARTBEAT_INTERVAL_MS = 5 * 60_000;

/**
 * How often a running protected job is reported. Must stay well under the
 * policy's 2-minute job grace, or a running job would lapse between reports.
 */
export const JOB_HEARTBEAT_INTERVAL_MS = 60_000;

/** Error code the backend returns when it has ended an idle session. */
export const SESSION_IDLE_TIMEOUT_CODE = 'SESSION_IDLE_TIMEOUT';

/** Window event the API client fires when the backend reports an idle timeout. */
export const SESSION_IDLE_TIMEOUT_EVENT = 'emithran:session-idle-timeout';

export interface SessionActivityTimes {
  lastActivityAt: number;
  lastJobAt: number | null;
}

/** Same rule as the server: see session-idle-policy.ts in the backend. */
export function sessionDeadline(
  { lastActivityAt, lastJobAt }: SessionActivityTimes,
  policy: SessionIdlePolicy,
): number {
  const idleDeadline = lastActivityAt + policy.idleTimeoutMs;
  if (lastJobAt === null) return idleDeadline;
  const jobDeadline = Math.min(lastJobAt + policy.jobGraceMs, idleDeadline + policy.jobExtensionMaxMs);
  return Math.max(idleDeadline, jobDeadline);
}

/** The Supabase session id in an access token's claims, or null. */
export function sessionIdFromAccessToken(token: string): string | null {
  const sessionId = decodeJwtPayload(token)?.session_id;
  return typeof sessionId === 'string' && sessionId ? sessionId : null;
}

export function isValidPolicy(value: unknown): value is SessionIdlePolicy {
  if (!value || typeof value !== 'object') return false;
  const p = value as Record<string, unknown>;
  return (['idleTimeoutMs', 'warningMs', 'jobExtensionMaxMs', 'jobGraceMs'] as const).every(
    (k) => typeof p[k] === 'number' && Number.isFinite(p[k]) && (p[k]) > 0,
  );
}
