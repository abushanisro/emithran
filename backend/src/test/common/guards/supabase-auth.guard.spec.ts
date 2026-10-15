import { ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { SupabaseAuthGuard } from '../../../common/guards/supabase-auth.guard';
import { type SupabaseService } from '../../../common/supabase/supabase.service';
import { type SessionActivityService } from '../../../common/session/session-activity.service';

/** A token shaped like a Supabase access token, carrying a session_id claim. */
const jwtFor = (sessionId: string) =>
  ['eyJhbGciOiJFUzI1NiJ9', Buffer.from(JSON.stringify({ sub: 'u', session_id: sessionId })).toString('base64url'), 'sig'].join('.');
const REAL_JWT = jwtFor('session-1');

function makeSessionActivity(assertActive: jest.Mock = jest.fn().mockResolvedValue({ lastActivityAt: 0, lastJobAt: null })) {
  return { assertActive } as unknown as SessionActivityService & { assertActive: jest.Mock };
}

const newGuard = (reflector: Reflector, svc: SupabaseService, sessionActivity = makeSessionActivity()) =>
  new SupabaseAuthGuard(reflector, svc, sessionActivity);

function makeContext(request: any): ExecutionContext {
  return {
    getHandler: () => ({}),
    getClass: () => ({}),
    switchToHttp: () => ({ getRequest: () => request }),
  } as unknown as ExecutionContext;
}

function makeReflector(isPublic = false): Reflector {
  return { getAllAndOverride: jest.fn().mockReturnValue(isPublic) } as unknown as Reflector;
}

function makeSupabaseService(opts: {
  verifyToken?: jest.Mock;
  adminFallbackEmail?: string | null;
  adminUserId?: string | null;
}): SupabaseService {
  const adminFallbackEmail = 'adminFallbackEmail' in opts ? opts.adminFallbackEmail : 'admin@example.com';
  const adminUserId = 'adminUserId' in opts ? opts.adminUserId : 'admin-uuid-1';
  return {
    verifyToken: opts.verifyToken ?? jest.fn().mockRejectedValue(new Error('invalid token')),
    getAdminFallbackEmail: jest.fn().mockReturnValue(adminFallbackEmail),
    getAdminUserId: jest.fn().mockResolvedValue(adminUserId),
    mintUserAccessToken: jest.fn().mockResolvedValue('minted-jwt'),
  } as unknown as SupabaseService;
}

describe('SupabaseAuthGuard', () => {
  const originalNodeEnv = process.env.NODE_ENV;

  afterEach(() => {
    process.env.NODE_ENV = originalNodeEnv;
  });

  it('lets public routes through without a token, in any environment', async () => {
    process.env.NODE_ENV = 'production';
    const guard = newGuard(makeReflector(true), makeSupabaseService({}));
    const request = { headers: {} };
    await expect(guard.canActivate(makeContext(request))).resolves.toBe(true);
  });

  it('authenticates a request carrying a valid bearer token, in production', async () => {
    process.env.NODE_ENV = 'production';
    const realUser = { id: 'user-1', email: 'real@customer.com', role: 'user' };
    const verifyToken = jest.fn().mockResolvedValue(realUser);
    const guard = newGuard(makeReflector(false), makeSupabaseService({ verifyToken }));
    const request = { headers: { authorization: `Bearer ${REAL_JWT}` } };
    await expect(guard.canActivate(makeContext(request))).resolves.toBe(true);
    expect(request).toHaveProperty('user', realUser);
  });

  it('rejects a request with no token in production, instead of falling back to an admin identity', async () => {
    process.env.NODE_ENV = 'production';
    const guard = newGuard(makeReflector(false), makeSupabaseService({}));
    const request = { headers: {} };
    await expect(guard.canActivate(makeContext(request))).rejects.toThrow(UnauthorizedException);
    expect(request).not.toHaveProperty('user');
  });

  it('rejects a request with an invalid/expired token in production, instead of falling back to an admin identity', async () => {
    process.env.NODE_ENV = 'production';
    const guard = newGuard(makeReflector(false), makeSupabaseService({}));
    const request = { headers: { authorization: 'Bearer garbage' } };
    await expect(guard.canActivate(makeContext(request))).rejects.toThrow(UnauthorizedException);
    expect(request).not.toHaveProperty('user');
  });

  it('rejects a request with no token in production even if ADMIN_FALLBACK_EMAIL resolves to a real account', async () => {
    process.env.NODE_ENV = 'production';
    const guard = newGuard(
      makeReflector(false),
      makeSupabaseService({ adminFallbackEmail: 'admin@example.com', adminUserId: 'admin-uuid-1' }),
    );
    const request = { headers: {} };
    await expect(guard.canActivate(makeContext(request))).rejects.toThrow(UnauthorizedException);
  });

  it('falls back to the configured admin identity when no token is sent outside production', async () => {
    process.env.NODE_ENV = 'development';
    const guard = newGuard(
      makeReflector(false),
      makeSupabaseService({ adminFallbackEmail: 'admin@example.com', adminUserId: 'admin-uuid-1' }),
    );
    const request = { headers: {} };
    await expect(guard.canActivate(makeContext(request))).resolves.toBe(true);
    expect(request).toHaveProperty('user', {
      id: 'admin-uuid-1',
      email: 'admin@example.com',
      role: 'admin',
    });
  });

  it('rejects outright when the development bypass has no admin account to resolve, even outside production', async () => {
    process.env.NODE_ENV = 'development';
    const guard = newGuard(
      makeReflector(false),
      makeSupabaseService({ adminFallbackEmail: null, adminUserId: null }),
    );
    const request = { headers: {} };
    await expect(guard.canActivate(makeContext(request))).rejects.toThrow(UnauthorizedException);
  });

  it('retries the admin lookup after a failed one instead of rejecting every later request', async () => {
    // A transient outage (confirmed live: getaddrinfo ENOTFOUND for the
    // Supabase host) makes the first lookup return null; once the network is
    // back, the next request must resolve the account again.
    process.env.NODE_ENV = 'development';
    const supabaseService = makeSupabaseService({ adminFallbackEmail: 'admin@example.com' });
    (supabaseService.getAdminUserId as jest.Mock)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce('admin-uuid-1');
    const guard = newGuard(makeReflector(false), supabaseService);

    await expect(guard.canActivate(makeContext({ headers: {} }))).rejects.toThrow(UnauthorizedException);

    const request = { headers: {} };
    await expect(guard.canActivate(makeContext(request))).resolves.toBe(true);
    expect(request).toHaveProperty('user.id', 'admin-uuid-1');

    // A resolved id is kept: no further lookups.
    await guard.canActivate(makeContext({ headers: {} }));
    expect(supabaseService.getAdminUserId).toHaveBeenCalledTimes(2);
  });

  describe('inactivity timeout', () => {
    const realUser = { id: 'user-1', email: 'real@customer.com', role: 'user' };

    it('checks the session idle deadline for a verified token and records the session id', async () => {
      process.env.NODE_ENV = 'production';
      const sessionActivity = makeSessionActivity();
      const guard = newGuard(
        makeReflector(false),
        makeSupabaseService({ verifyToken: jest.fn().mockResolvedValue(realUser) }),
        sessionActivity,
      );
      const request: any = { headers: { authorization: `Bearer ${REAL_JWT}` } };
      await expect(guard.canActivate(makeContext(request))).resolves.toBe(true);
      expect(sessionActivity.assertActive).toHaveBeenCalledWith('session-1', 'user-1', REAL_JWT);
      expect(request.sessionId).toBe('session-1');
    });

    it('rejects an idle session and never attaches the user', async () => {
      process.env.NODE_ENV = 'production';
      const idle = new UnauthorizedException({ message: 'idle', code: 'SESSION_IDLE_TIMEOUT' });
      const guard = newGuard(
        makeReflector(false),
        makeSupabaseService({ verifyToken: jest.fn().mockResolvedValue(realUser) }),
        makeSessionActivity(jest.fn().mockRejectedValue(idle)),
      );
      const request: any = { headers: { authorization: `Bearer ${REAL_JWT}` } };
      await expect(guard.canActivate(makeContext(request))).rejects.toBe(idle);
      expect(request).not.toHaveProperty('user');
    });

    it('rejects an idle session outside production too, instead of falling back to the admin identity', async () => {
      process.env.NODE_ENV = 'development';
      const idle = new UnauthorizedException({ message: 'idle', code: 'SESSION_IDLE_TIMEOUT' });
      const supabaseService = makeSupabaseService({ verifyToken: jest.fn().mockResolvedValue(realUser) });
      const guard = newGuard(makeReflector(false), supabaseService, makeSessionActivity(jest.fn().mockRejectedValue(idle)));
      const request: any = { headers: { authorization: `Bearer ${REAL_JWT}` } };
      await expect(guard.canActivate(makeContext(request))).rejects.toBe(idle);
      expect(supabaseService.mintUserAccessToken).not.toHaveBeenCalled();
    });

    it('rejects a verified token that carries no session id', async () => {
      process.env.NODE_ENV = 'production';
      const sessionActivity = makeSessionActivity();
      const guard = newGuard(
        makeReflector(false),
        makeSupabaseService({ verifyToken: jest.fn().mockResolvedValue(realUser) }),
        sessionActivity,
      );
      const noSession = ['eyJhbGciOiJFUzI1NiJ9', Buffer.from('{"sub":"u"}').toString('base64url'), 'sig'].join('.');
      await expect(
        guard.canActivate(makeContext({ headers: { authorization: `Bearer ${noSession}` } })),
      ).rejects.toThrow(UnauthorizedException);
      expect(sessionActivity.assertActive).not.toHaveBeenCalled();
    });

    it('does not apply the idle check to the development bypass, which has no Supabase session', async () => {
      process.env.NODE_ENV = 'development';
      const sessionActivity = makeSessionActivity();
      const guard = newGuard(makeReflector(false), makeSupabaseService({}), sessionActivity);
      await expect(guard.canActivate(makeContext({ headers: {} }))).resolves.toBe(true);
      expect(sessionActivity.assertActive).not.toHaveBeenCalled();
    });
  });
});
