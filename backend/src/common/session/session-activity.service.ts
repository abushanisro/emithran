import {
  Injectable,
  Logger,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { DatabaseService } from '../database/database.service';
import { evictOldestIfFull } from '../cache/bounded-map';
import { SESSION_IDLE_POLICY, sessionDeadline, type SessionActivityTimes } from './session-idle-policy';

export type ActivityKind = 'user' | 'job';

const TABLE = 'user_session_activity';
/** PostgREST / Postgres codes for "the table does not exist" (migration 901 not applied). */
const MISSING_TABLE_CODES = new Set(['PGRST205', '42P01']);
// The only environments where a missing table may be passed over; everything else (production, staging, unset) fails closed.
const LOCAL_ENVS = new Set(['development', 'test']);
const MAX_CACHED_SESSIONS = 10_000;

export const SESSION_IDLE_TIMEOUT_CODE = 'SESSION_IDLE_TIMEOUT';

/**
 * Server-side enforcement of the inactivity timeout (migration 901).
 *
 * The browser countdown is only a convenience: this is what actually ends an
 * idle session. A session past its deadline is rejected, and keeps being
 * rejected: its stored deadline does not move, and the browser signs out.
 *
 * Times are cached per instance. Every stored time only moves forward, so a
 * cached deadline can only be earlier than the real one: trusting it while it
 * is still in the future is always safe, and a cached deadline that looks past
 * is re-read from the database before anything is rejected.
 */
@Injectable()
export class SessionActivityService {
  private readonly logger = new Logger(SessionActivityService.name);
  private readonly cache = new Map<string, SessionActivityTimes>();

  constructor(private readonly databaseService: DatabaseService) {}

  /** Throws 401 if the session is past its deadline. */
  async assertActive(sessionId: string, userId: string, now = Date.now()): Promise<SessionActivityTimes> {
    const cached = this.cache.get(sessionId);
    if (cached && sessionDeadline(cached) > now) return cached;

    let times: SessionActivityTimes | null;
    try {
      times = await this.read(sessionId);
      // First request from this session: its idle clock starts now.
      times ??= await this.write(sessionId, userId, { last_activity_at: new Date(now).toISOString() });
    } catch (error) {
      return this.unenforcedOrThrow(error, now);
    }
    if (sessionDeadline(times) <= now) {
      this.cache.delete(sessionId);
      throw new UnauthorizedException({
        message: 'Your session ended after 30 minutes of inactivity. Please sign in again.',
        code: SESSION_IDLE_TIMEOUT_CODE,
      });
    }
    this.remember(sessionId, times);
    return times;
  }

  /** Records a heartbeat. Call only after assertActive, so an expired session can never be revived. */
  async recordActivity(sessionId: string, userId: string, kind: ActivityKind, now = Date.now()): Promise<SessionActivityTimes> {
    const at = new Date(now).toISOString();
    try {
      const times = await this.write(sessionId, userId, kind === 'user' ? { last_activity_at: at } : { last_job_at: at });
      this.remember(sessionId, times);
      return times;
    } catch (error) {
      return this.unenforcedOrThrow(error, now);
    }
  }

  private get db() {
    return this.databaseService.getPrivilegedClient(
      'session-idle: user_session_activity is service-only, no user RLS policies exist',
    );
  }

  private async read(sessionId: string): Promise<SessionActivityTimes | null> {
    const { data, error } = await this.db
      .from(TABLE)
      .select('last_activity_at, last_job_at')
      .eq('session_id', sessionId)
      .maybeSingle();
    if (error) throw storageError(error);
    return data ? toTimes(data) : null;
  }

  private async write(sessionId: string, userId: string, columns: Record<string, string>): Promise<SessionActivityTimes> {
    const { data, error } = await this.db
      .from(TABLE)
      .upsert({ session_id: sessionId, user_id: userId, ...columns }, { onConflict: 'session_id' })
      .select('last_activity_at, last_job_at')
      .single();
    if (error) throw storageError(error);
    return toTimes(data);
  }

  private remember(sessionId: string, times: SessionActivityTimes): void {
    evictOldestIfFull(this.cache, MAX_CACHED_SESSIONS);
    this.cache.set(sessionId, times);
  }

  /**
   * Production fails closed: no request is allowed when the deadline cannot be checked.
   * 503, not 401, so the browser does not treat a storage outage as a sign-out.
   * Only when NODE_ENV is explicitly 'development' or 'test' is a missing table (migration 901 not applied yet) let
   * through with a warning, so local work keeps going before the migration runs. Any other value (staging, unset) fails closed.
   */
  private unenforcedOrThrow(error: unknown, now: number): SessionActivityTimes {
    if (!(error instanceof SessionStorageError)) throw error;
    if (LOCAL_ENVS.has(process.env.NODE_ENV ?? '') && error.code && MISSING_TABLE_CODES.has(error.code)) {
      this.logger.warn(`${TABLE} is missing (run migration 901); inactivity timeout NOT enforced in ${process.env.NODE_ENV}`);
      return { lastActivityAt: now, lastJobAt: null };
    }
    this.logger.error(`Session activity check failed: ${error.code ?? ''} ${error.message}`);
    throw new ServiceUnavailableException({
      message: 'Session check is temporarily unavailable. Please try again.',
      code: 'SESSION_CHECK_UNAVAILABLE',
    });
  }
}

class SessionStorageError extends Error {
  constructor(readonly code: string | undefined, message: string) {
    super(message);
  }
}

function storageError(error: { code?: string; message: string }): SessionStorageError {
  return new SessionStorageError(error.code, error.message);
}

function toTimes(row: { last_activity_at: string; last_job_at: string | null }): SessionActivityTimes {
  return {
    lastActivityAt: Date.parse(row.last_activity_at),
    lastJobAt: row.last_job_at ? Date.parse(row.last_job_at) : null,
  };
}

export { SESSION_IDLE_POLICY };
