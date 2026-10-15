import { ServiceUnavailableException, UnauthorizedException } from '@nestjs/common';
import {
  SESSION_IDLE_POLICY,
  sessionDeadline,
  sessionIdFromAccessToken,
} from '../../../common/session/session-idle-policy';
import { SessionActivityService, SESSION_IDLE_TIMEOUT_CODE } from '../../../common/session/session-activity.service';
import { type SupabaseService } from '../../../common/supabase/supabase.service';
import { getVerified, rememberVerified } from '../../../common/supabase/token-verification-cache';

const MIN = 60_000;
const T0 = Date.parse('2026-10-15T09:00:00Z');
const iso = (ms: number) => new Date(ms).toISOString();

type Row = { last_activity_at: string; last_job_at: string | null };

/** In-memory stand-in for user_session_activity behind the privileged client. */
function fakeSupabase(opts: { readError?: object; writeError?: object } = {}) {
  const rows = new Map<string, Row>();
  const reads = jest.fn();
  const signOut = jest.fn().mockResolvedValue({ error: null });
  const client = {
    from: () => {
      let id = '';
      let upsert: Record<string, string> | null = null;
      const q: any = {
        select: () => q,
        eq: (_col: string, value: string) => ((id = value), q),
        maybeSingle: async () => {
          reads(id);
          return opts.readError ? { data: null, error: opts.readError } : { data: rows.get(id) ?? null, error: null };
        },
        upsert: (payload: Record<string, string>) => ((upsert = payload), q),
        single: async () => {
          if (opts.writeError) return { data: null, error: opts.writeError };
          const { session_id, user_id: _user, ...columns } = upsert!;
          const next = { ...(rows.get(session_id) ?? { last_activity_at: iso(T0), last_job_at: null }), ...columns };
          rows.set(session_id, next);
          return { data: next, error: null };
        },
      };
      return q;
    },
    auth: { admin: { signOut } },
  };
  const service = { getPrivilegedClient: jest.fn().mockReturnValue(client) } as unknown as SupabaseService;
  return { service, rows, reads, signOut };
}

describe('session idle policy', () => {
  it('is the CTO-approved 30-minute timeout with a 2-minute warning and a 15-minute job cap', () => {
    expect(SESSION_IDLE_POLICY).toEqual({
      idleTimeoutMs: 30 * MIN,
      warningMs: 2 * MIN,
      jobExtensionMaxMs: 15 * MIN,
      jobGraceMs: 2 * MIN,
    });
  });

  it('expires 30 minutes after the last user activity when no job is running', () => {
    expect(sessionDeadline({ lastActivityAt: T0, lastJobAt: null })).toBe(T0 + 30 * MIN);
  });

  it('keeps a session alive 2 minutes past each job heartbeat after the idle deadline', () => {
    expect(sessionDeadline({ lastActivityAt: T0, lastJobAt: T0 + 35 * MIN })).toBe(T0 + 37 * MIN);
  });

  it('never extends a session more than 15 minutes past the idle deadline, however long the job runs', () => {
    expect(sessionDeadline({ lastActivityAt: T0, lastJobAt: T0 + 44 * MIN })).toBe(T0 + 45 * MIN);
    expect(sessionDeadline({ lastActivityAt: T0, lastJobAt: T0 + 90 * MIN })).toBe(T0 + 45 * MIN);
  });

  it('ignores an old job heartbeat that ended before the idle deadline', () => {
    expect(sessionDeadline({ lastActivityAt: T0, lastJobAt: T0 + 5 * MIN })).toBe(T0 + 30 * MIN);
  });

  it('reads the session id claim from an access token', () => {
    const token = ['h', Buffer.from(JSON.stringify({ session_id: 'abc' })).toString('base64url'), 's'].join('.');
    expect(sessionIdFromAccessToken(token)).toBe('abc');
    expect(sessionIdFromAccessToken('not-a-jwt')).toBeNull();
    expect(sessionIdFromAccessToken(['h', Buffer.from('{}').toString('base64url'), 's'].join('.'))).toBeNull();
  });
});

describe('SessionActivityService', () => {
  const originalEnv = process.env.NODE_ENV;
  beforeEach(() => {
    process.env.NODE_ENV = 'production';
  });
  afterEach(() => {
    process.env.NODE_ENV = originalEnv;
  });

  it('starts the idle clock on the first request of a session', async () => {
    const db = fakeSupabase();
    const svc = new SessionActivityService(db.service);
    await expect(svc.assertActive('s1', 'u1', 'tok', T0)).resolves.toEqual({ lastActivityAt: T0, lastJobAt: null });
    expect(db.rows.get('s1')?.last_activity_at).toBe(iso(T0));
  });

  it('allows requests until the deadline without moving it (API traffic is not activity)', async () => {
    const db = fakeSupabase();
    const svc = new SessionActivityService(db.service);
    await svc.assertActive('s1', 'u1', 'tok', T0);
    await svc.assertActive('s1', 'u1', 'tok', T0 + 29 * MIN);
    expect(db.rows.get('s1')?.last_activity_at).toBe(iso(T0));
  });

  it('rejects and revokes a session idle for 30 minutes', async () => {
    const db = fakeSupabase();
    const svc = new SessionActivityService(db.service);
    await svc.assertActive('s1', 'u1', 'tok', T0);
    const err = await svc.assertActive('s1', 'u1', 'tok', T0 + 30 * MIN).catch((e) => e);
    expect(err).toBeInstanceOf(UnauthorizedException);
    expect(err.getResponse()).toMatchObject({ code: SESSION_IDLE_TIMEOUT_CODE });
    expect(db.signOut).toHaveBeenCalledWith('tok', 'local');
  });

  it('drops the revoked token from the verified-token cache the guard uses', async () => {
    const db = fakeSupabase();
    const svc = new SessionActivityService(db.service);
    await svc.assertActive('s1', 'u1', 'tok', T0);
    rememberVerified('tok', { id: 'u1' });
    await svc.assertActive('s1', 'u1', 'tok', T0 + 30 * MIN).catch(() => undefined);
    expect(getVerified('tok')).toBeUndefined();
  });

  it('serves a still-valid cached deadline without a database read', async () => {
    const db = fakeSupabase();
    const svc = new SessionActivityService(db.service);
    await svc.assertActive('s1', 'u1', 'tok', T0);
    db.reads.mockClear();
    await svc.assertActive('s1', 'u1', 'tok', T0 + 10 * MIN);
    expect(db.reads).not.toHaveBeenCalled();
  });

  it('re-reads the database before rejecting, so activity recorded by another instance counts', async () => {
    const db = fakeSupabase();
    const svc = new SessionActivityService(db.service);
    await svc.assertActive('s1', 'u1', 'tok', T0);
    db.rows.set('s1', { last_activity_at: iso(T0 + 20 * MIN), last_job_at: null });
    await expect(svc.assertActive('s1', 'u1', 'tok', T0 + 31 * MIN)).resolves.toMatchObject({ lastActivityAt: T0 + 20 * MIN });
    expect(db.signOut).not.toHaveBeenCalled();
  });

  it('moves the idle clock only on a user heartbeat', async () => {
    const db = fakeSupabase();
    const svc = new SessionActivityService(db.service);
    await svc.assertActive('s1', 'u1', 'tok', T0);
    await svc.recordActivity('s1', 'u1', 'user', T0 + 25 * MIN);
    await expect(svc.assertActive('s1', 'u1', 'tok', T0 + 50 * MIN)).resolves.toBeDefined();
    await expect(svc.assertActive('s1', 'u1', 'tok', T0 + 55 * MIN)).rejects.toThrow(UnauthorizedException);
  });

  it('lets a running job extend the session, but never past 15 minutes beyond the idle deadline', async () => {
    const db = fakeSupabase();
    const svc = new SessionActivityService(db.service);
    await svc.assertActive('s1', 'u1', 'tok', T0);
    for (let m = 29; m <= 50; m++) {
      if (T0 + m * MIN < T0 + 45 * MIN) {
        await svc.assertActive('s1', 'u1', 'tok', T0 + m * MIN);
        await svc.recordActivity('s1', 'u1', 'job', T0 + m * MIN);
      }
    }
    await expect(svc.assertActive('s1', 'u1', 'tok', T0 + 45 * MIN - 1)).resolves.toBeDefined();
    await expect(svc.assertActive('s1', 'u1', 'tok', T0 + 45 * MIN)).rejects.toThrow(UnauthorizedException);
  });

  it('ends the session 2 minutes after the job finishes, once past the idle deadline', async () => {
    const db = fakeSupabase();
    const svc = new SessionActivityService(db.service);
    await svc.assertActive('s1', 'u1', 'tok', T0);
    await svc.recordActivity('s1', 'u1', 'job', T0 + 33 * MIN - 1);
    await expect(svc.assertActive('s1', 'u1', 'tok', T0 + 34 * MIN)).resolves.toBeDefined();
    await expect(svc.assertActive('s1', 'u1', 'tok', T0 + 35 * MIN)).rejects.toThrow(UnauthorizedException);
  });

  it('fails closed with 503 (not 401) in production when the check cannot be made', async () => {
    const db = fakeSupabase({ readError: { code: 'PGRST205', message: 'missing table' } });
    const svc = new SessionActivityService(db.service);
    await expect(svc.assertActive('s1', 'u1', 'tok', T0)).rejects.toThrow(ServiceUnavailableException);
  });

  it('lets requests through outside production while migration 901 is not applied', async () => {
    process.env.NODE_ENV = 'development';
    const db = fakeSupabase({ readError: { code: 'PGRST205', message: 'missing table' } });
    const svc = new SessionActivityService(db.service);
    await expect(svc.assertActive('s1', 'u1', 'tok', T0)).resolves.toEqual({ lastActivityAt: T0, lastJobAt: null });
  });

  it('still fails closed outside production for any other storage error', async () => {
    process.env.NODE_ENV = 'development';
    const db = fakeSupabase({ readError: { code: '08006', message: 'connection failure' } });
    const svc = new SessionActivityService(db.service);
    await expect(svc.assertActive('s1', 'u1', 'tok', T0)).rejects.toThrow(ServiceUnavailableException);
  });

  it('treats a session deleted mid-request (foreign key violation) as signed out', async () => {
    const db = fakeSupabase({ writeError: { code: '23503', message: 'fk' } });
    const svc = new SessionActivityService(db.service);
    await expect(svc.assertActive('s1', 'u1', 'tok', T0)).rejects.toThrow(UnauthorizedException);
  });
});
