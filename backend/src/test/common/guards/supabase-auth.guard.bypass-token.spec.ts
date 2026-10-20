import { ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { SupabaseAuthGuard } from '../../../common/guards/supabase-auth.guard';
import { SupabaseService } from '../../../common/supabase/supabase.service';
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

const ctx = (request: any) =>
  ({ getHandler: () => ({}), getClass: () => ({}), switchToHttp: () => ({ getRequest: () => request }) }) as unknown as ExecutionContext;
const reflector = { getAllAndOverride: jest.fn().mockReturnValue(false) } as unknown as Reflector;

function service(over: Partial<Record<keyof SupabaseService, jest.Mock>> = {}) {
  return {
    verifyToken: jest.fn().mockRejectedValue(new Error('invalid')),
    // The real predicate (not production AND flag 'true'), fed the flag the test wants.
    isDevAuthBypassEnabled: () => SupabaseService.prototype.isDevAuthBypassEnabled.call({ configService: { get: () => 'true' } }),
    getAdminFallbackEmail: jest.fn().mockReturnValue('dev@example.com'),
    getAdminUserId: jest.fn().mockResolvedValue('dev-uuid'),
    mintUserAccessToken: jest.fn().mockResolvedValue('minted.real.jwt'),
    ...over,
  } as unknown as SupabaseService & { mintUserAccessToken: jest.Mock };
}

describe('SupabaseAuthGuard dev bypass: real user token, never a null/admin token', () => {
  const originalEnv = process.env.NODE_ENV;
  afterEach(() => {
    process.env.NODE_ENV = originalEnv;
  });

  it('gives a no-token dev request the minted user JWT for the fallback account', async () => {
    process.env.NODE_ENV = 'development';
    const svc = service();
    const request: any = { headers: {} };
    await expect(newGuard(reflector, svc).canActivate(ctx(request))).resolves.toBe(true);
    expect(request.accessToken).toBe('minted.real.jwt');
    expect(request.user.id).toBe('dev-uuid');
    expect(svc.mintUserAccessToken).toHaveBeenCalledWith('dev@example.com');
  });

  it('gives an invalid-token dev request the minted user JWT, not the bad token', async () => {
    process.env.NODE_ENV = 'development';
    const request: any = { headers: { authorization: 'Bearer garbage' } };
    await newGuard(reflector, service()).canActivate(ctx(request));
    expect(request.accessToken).toBe('minted.real.jwt');
  });

  it('leaves accessToken null when minting fails, so DB access fails closed', async () => {
    process.env.NODE_ENV = 'development';
    const request: any = { headers: {} };
    await newGuard(reflector, service({ mintUserAccessToken: jest.fn().mockResolvedValue(null) })).canActivate(ctx(request));
    expect(request.accessToken).toBeNull();
  });

  it('never mints a token in production: a missing token is rejected outright', async () => {
    process.env.NODE_ENV = 'production';
    const svc = service();
    await expect(newGuard(reflector, svc).canActivate(ctx({ headers: {} }))).rejects.toThrow(UnauthorizedException);
    expect(svc.mintUserAccessToken).not.toHaveBeenCalled();
  });

  it('keeps a real bearer token as-is for an authenticated request (behaviour unchanged)', async () => {
    process.env.NODE_ENV = 'production';
    const svc = service({ verifyToken: jest.fn().mockResolvedValue({ id: 'u1', email: 'a@b.c', role: 'user' }) });
    const request: any = { headers: { authorization: `Bearer ${REAL_JWT}` } };
    await newGuard(reflector, svc).canActivate(ctx(request));
    expect(request.accessToken).toBe(REAL_JWT);
    expect(svc.mintUserAccessToken).not.toHaveBeenCalled();
  });
});
