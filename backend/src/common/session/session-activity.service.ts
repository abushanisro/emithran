import {
  Injectable,
  Logger,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { SupabaseService } from '../supabase/supabase.service';
import { evictOldestIfFull } from '../cache/bounded-map';
import { forgetVerified } from '../supabase/token-verification-cache';
import { SESSION_IDLE_POLICY, sessionDeadline, type SessionActivityTimes } from './session-idle-policy';

export type ActivityKind = 'user' | 'job';

const TABLE = 'user_session_activity';
/** PostgREST / Postgres codes for "the table does not exist" (migration 901 not applied). */
const MISSING_TABLE_CODES = new Set(['PGRST205', '42P01']);
/** The session row's foreign key: the Supabase session was deleted under us. */
const FK_VIOLATION = '23503';
const MAX_CACHED_SESSIONS = 10_000;

export const SESSION_IDLE_TIMEOUT_CODE = 'SESSION_IDLE_TIMEOUT';

/**
 * Server-side enforcement of the inactivity timeout (migration 901).
 *
 * The browser countdown is only a convenience: this is what actually ends an
 * idle session. A session past its deadline is rejected AND revoked in
 * Supabase, so its refresh token stops working too.
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

  constructor(private readonly supabaseService: SupabaseService) {}

  /** Throws 401 (and revokes the session) if it is past its deadline. */
  async assertActive(sessionId: string, userId: string, accessToken: string, now = Date.now()): Promise<SessionActivityTimes> {
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
      await this.expire(sessionId, accessToken);
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
    return this.supabaseService.getPrivilegedClient(
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
    if (error) {
      if (error.code === FK_VIOLATION) {
        throw new UnauthorizedException('Your session has ended. Please sign in again.');
      }
      throw storageError(error);
    }
    return toTimes(data);
  }

  /** Supabase: revokes the session (its row goes with it, ON DELETE CASCADE). Plain Postgres: only forgets it; the row stays and keeps rejecting. */
  private async expire(sessionId: string, accessToken: string): Promise<void> {
    this.cache.delete(sessionId);
    // The guard's verified-token cache must not keep accepting this token.
    forgetVerified(accessToken);
    // Auth0 sessions have nothing to revoke here: the stored deadline keeps rejecting this session, and the browser signs out.
    if (this.supabaseService.usesPostgrest()) return;
    const { error } = await this.supabaseService
      .getPrivilegedClient('session-idle: revoke a Supabase session that passed its inactivity deadline')
      .auth.admin.signOut(accessToken, 'local');
    if (error) {
      // The request is still rejected; the next one re-checks and retries the revoke.
      this.logger.warn(`Could not revoke idle session ${sessionId}: ${error.message}`);
    }
  }

  private remember(sessionId: string, times: SessionActivityTimes): void {
    evictOldestIfFull(this.cache, MAX_CACHED_SESSIONS);
    this.cache.set(sessionId, times);
  }

  /**
   * Production fails closed: no request is allowed when the deadline cannot be checked.
   * 503, not 401, so the browser does not treat a storage outage as a sign-out.
   * Outside production a missing table (migration 901 not applied yet) is let
   * through with a warning, so local work keeps going before the migration runs.
   */
  private unenforcedOrThrow(error: unknown, now: number): SessionActivityTimes {
    if (!(error instanceof SessionStorageError)) throw error;
    if (process.env.NODE_ENV !== 'production' && error.code && MISSING_TABLE_CODES.has(error.code)) {
      this.logger.warn(`${TABLE} is missing (run migration 901); inactivity timeout NOT enforced outside production`);
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
