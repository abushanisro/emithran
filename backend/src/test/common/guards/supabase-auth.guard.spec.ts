import { ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { SupabaseAuthGuard } from '../../../common/guards/supabase-auth.guard';
import { type SupabaseService } from '../../../common/supabase/supabase.service';

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
  } as unknown as SupabaseService;
}

describe('SupabaseAuthGuard', () => {
  const originalNodeEnv = process.env.NODE_ENV;

  afterEach(() => {
    process.env.NODE_ENV = originalNodeEnv;
  });

  it('lets public routes through without a token, in any environment', async () => {
    process.env.NODE_ENV = 'production';
    const guard = new SupabaseAuthGuard(makeReflector(true), makeSupabaseService({}));
    const request = { headers: {} };
    await expect(guard.canActivate(makeContext(request))).resolves.toBe(true);
  });

  it('authenticates a request carrying a valid bearer token, in production', async () => {
    process.env.NODE_ENV = 'production';
    const realUser = { id: 'user-1', email: 'real@customer.com', role: 'user' };
    const verifyToken = jest.fn().mockResolvedValue(realUser);
    const guard = new SupabaseAuthGuard(makeReflector(false), makeSupabaseService({ verifyToken }));
    const request = { headers: { authorization: 'Bearer real-jwt' } };
    await expect(guard.canActivate(makeContext(request))).resolves.toBe(true);
    expect(request).toHaveProperty('user', realUser);
  });

  it('rejects a request with no token in production, instead of falling back to an admin identity', async () => {
    process.env.NODE_ENV = 'production';
    const guard = new SupabaseAuthGuard(makeReflector(false), makeSupabaseService({}));
    const request = { headers: {} };
    await expect(guard.canActivate(makeContext(request))).rejects.toThrow(UnauthorizedException);
    expect(request).not.toHaveProperty('user');
  });

  it('rejects a request with an invalid/expired token in production, instead of falling back to an admin identity', async () => {
    process.env.NODE_ENV = 'production';
    const guard = new SupabaseAuthGuard(makeReflector(false), makeSupabaseService({}));
    const request = { headers: { authorization: 'Bearer garbage' } };
    await expect(guard.canActivate(makeContext(request))).rejects.toThrow(UnauthorizedException);
    expect(request).not.toHaveProperty('user');
  });

  it('rejects a request with no token in production even if ADMIN_FALLBACK_EMAIL resolves to a real account', async () => {
    process.env.NODE_ENV = 'production';
    const guard = new SupabaseAuthGuard(
      makeReflector(false),
      makeSupabaseService({ adminFallbackEmail: 'admin@example.com', adminUserId: 'admin-uuid-1' }),
    );
    const request = { headers: {} };
    await expect(guard.canActivate(makeContext(request))).rejects.toThrow(UnauthorizedException);
  });

  it('falls back to the configured admin identity when no token is sent outside production', async () => {
    process.env.NODE_ENV = 'development';
    const guard = new SupabaseAuthGuard(
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
    const guard = new SupabaseAuthGuard(
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
    const guard = new SupabaseAuthGuard(makeReflector(false), supabaseService);

    await expect(guard.canActivate(makeContext({ headers: {} }))).rejects.toThrow(UnauthorizedException);

    const request = { headers: {} };
    await expect(guard.canActivate(makeContext(request))).resolves.toBe(true);
    expect(request).toHaveProperty('user.id', 'admin-uuid-1');

    // A resolved id is kept: no further lookups.
    await guard.canActivate(makeContext({ headers: {} }));
    expect(supabaseService.getAdminUserId).toHaveBeenCalledTimes(2);
  });
});
