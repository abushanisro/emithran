import {
  Injectable,
  Logger,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { DatabaseService } from '../database/database.service';
import { evictOldestIfFull } from '../cache/bounded-map';
import { SESSION_IDLE_POLICY, idleTimeoutEnabled, sessionDeadline, type SessionActivityTimes } from './session-idle-policy';

export type ActivityKind = 'user' | 'job';

const TABLE = 'user_session_activity';
/** PostgREST / Postgres codes for "the table does not exist" (migration 901 not applied). */
const MISSING_TABLE_CODES = new Set(['PGRST205', '42P01']);
// The only environments where a missing table may be passed over; everything else (production, staging, unset) fails closed.
const LOCAL_ENVS = new Set(['development', 'test']);
const MAX_CACHED_SESSIONS = 10_000;

export const SESSION_IDLE_TIMEOUT_CODE = 'SESSION_IDLE_TIMEOUT';
export const SESSION_ENDED_CODE = 'SESSION_ENDED';

/** A session's stored times, plus whether it was ended at logout (migration 1000). */
type StoredTimes = SessionActivityTimes & { ended: boolean };

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
  private readonly cache = new Map<string, StoredTimes>();

  constructor(private readonly databaseService: DatabaseService) {}

  /** Throws 401 if the session is past its deadline. */
  async assertActive(sessionId: string, userId: string, now = Date.now()): Promise<SessionActivityTimes> {
    // Switched off: no session is ever past a deadline, and nothing is read or stored.
    if (!idleTimeoutEnabled()) return { lastActivityAt: now, lastJobAt: null };
    const cached = this.cache.get(sessionId);
    if (cached && !cached.ended && sessionDeadline(cached) > now) return times(cached);

    let stored: StoredTimes | null;
    try {
      stored = await this.read(sessionId);
      // First request from this session: its idle clock starts now.
      stored ??= await this.write(sessionId, userId, { last_activity_at: new Date(now).toISOString() });
    } catch (error) {
      return this.unenforcedOrThrow(error, now);
    }
    if (stored.ended) throw this.ended(sessionId);
    if (sessionDeadline(stored) <= now) {
      this.cache.delete(sessionId);
      throw new UnauthorizedException({
        message: 'Your session ended after 30 minutes of inactivity. Please sign in again.',
        code: SESSION_IDLE_TIMEOUT_CODE,
      });
    }
    this.remember(sessionId, stored);
    return times(stored);
  }

  /**
   * Ends the session at logout: from now on every request carrying it is refused, even from a copied cookie whose access token has not
   * expired yet. The row is kept (a deleted row would give the session a fresh idle clock). This instance forgets its cached times at
   * once; another backend instance would keep its cached deadline (at most 30 minutes). Production runs one backend instance.
   */
  async end(sessionId: string, userId: string, now = Date.now()): Promise<void> {
    try {
      this.remember(sessionId, await this.write(sessionId, userId, { ended_at: new Date(now).toISOString() }));
    } catch (error) {
      this.unenforcedOrThrow(error, now);
    }
  }

  /** Records a heartbeat. Call only after assertActive, so an expired session can never be revived. */
  async recordActivity(sessionId: string, userId: string, kind: ActivityKind, now = Date.now()): Promise<SessionActivityTimes> {
    const at = new Date(now).toISOString();
    let stored: StoredTimes;
    try {
      stored = await this.write(sessionId, userId, kind === 'user' ? { last_activity_at: at } : { last_job_at: at });
    } catch (error) {
      return this.unenforcedOrThrow(error, now);
    }
    if (stored.ended) throw this.ended(sessionId);
    this.remember(sessionId, stored);
    return times(stored);
  }

  private ended(sessionId: string): UnauthorizedException {
    this.cache.delete(sessionId);
    return new UnauthorizedException({ message: 'This session was signed out. Please sign in again.', code: SESSION_ENDED_CODE });
  }

  private get db() {
    return this.databaseService.getPrivilegedClient(
      'session-idle: user_session_activity is service-only, no user RLS policies exist',
    );
  }

  private async read(sessionId: string): Promise<StoredTimes | null> {
    const { data, error } = await this.db
      .from(TABLE)
      .select('last_activity_at, last_job_at, ended_at')
      .eq('session_id', sessionId)
      .maybeSingle();
    if (error) throw storageError(error);
    return data ? toTimes(data) : null;
  }

  private async write(sessionId: string, userId: string, columns: Record<string, string>): Promise<StoredTimes> {
    const { data, error } = await this.db
      .from(TABLE)
      .upsert({ session_id: sessionId, user_id: userId, ...columns }, { onConflict: 'session_id' })
      .select('last_activity_at, last_job_at, ended_at')
      .single();
    if (error) throw storageError(error);
    return toTimes(data);
  }

  private remember(sessionId: string, times: StoredTimes): void {
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

function toTimes(row: { last_activity_at: string; last_job_at: string | null; ended_at?: string | null }): StoredTimes {
  return {
    lastActivityAt: Date.parse(row.last_activity_at),
    lastJobAt: row.last_job_at ? Date.parse(row.last_job_at) : null,
    ended: Boolean(row.ended_at),
  };
}

/** The idle times alone (what callers and the session endpoint see). */
function times({ lastActivityAt, lastJobAt }: StoredTimes): SessionActivityTimes {
  return { lastActivityAt, lastJobAt };
}

export { SESSION_IDLE_POLICY };
