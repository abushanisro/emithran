import { ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { SupabaseAuthGuard } from '../../../common/guards/supabase-auth.guard';
import { type SupabaseService } from '../../../common/supabase/supabase.service';

const ctx = (request: any) =>
  ({ getHandler: () => ({}), getClass: () => ({}), switchToHttp: () => ({ getRequest: () => request }) }) as unknown as ExecutionContext;
const reflector = { getAllAndOverride: jest.fn().mockReturnValue(false) } as unknown as Reflector;

function service(over: Partial<Record<keyof SupabaseService, jest.Mock>> = {}) {
  return {
    verifyToken: jest.fn().mockRejectedValue(new Error('invalid')),
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
    await expect(new SupabaseAuthGuard(reflector, svc).canActivate(ctx(request))).resolves.toBe(true);
    expect(request.accessToken).toBe('minted.real.jwt');
    expect(request.user.id).toBe('dev-uuid');
    expect(svc.mintUserAccessToken).toHaveBeenCalledWith('dev@example.com');
  });

  it('gives an invalid-token dev request the minted user JWT, not the bad token', async () => {
    process.env.NODE_ENV = 'development';
    const request: any = { headers: { authorization: 'Bearer garbage' } };
    await new SupabaseAuthGuard(reflector, service()).canActivate(ctx(request));
    expect(request.accessToken).toBe('minted.real.jwt');
  });

  it('leaves accessToken null when minting fails, so DB access fails closed', async () => {
    process.env.NODE_ENV = 'development';
    const request: any = { headers: {} };
    await new SupabaseAuthGuard(reflector, service({ mintUserAccessToken: jest.fn().mockResolvedValue(null) })).canActivate(ctx(request));
    expect(request.accessToken).toBeNull();
  });

  it('never mints a token in production: a missing token is rejected outright', async () => {
    process.env.NODE_ENV = 'production';
    const svc = service();
    await expect(new SupabaseAuthGuard(reflector, svc).canActivate(ctx({ headers: {} }))).rejects.toThrow(UnauthorizedException);
    expect(svc.mintUserAccessToken).not.toHaveBeenCalled();
  });

  it('keeps a real bearer token as-is for an authenticated request (behaviour unchanged)', async () => {
    process.env.NODE_ENV = 'production';
    const svc = service({ verifyToken: jest.fn().mockResolvedValue({ id: 'u1', email: 'a@b.c', role: 'user' }) });
    const request: any = { headers: { authorization: 'Bearer real-jwt' } };
    await new SupabaseAuthGuard(reflector, svc).canActivate(ctx(request));
    expect(request.accessToken).toBe('real-jwt');
    expect(svc.mintUserAccessToken).not.toHaveBeenCalled();
  });
});
