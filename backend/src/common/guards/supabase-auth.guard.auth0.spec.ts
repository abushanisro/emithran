import { ForbiddenException, UnauthorizedException, type ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';

import { SupabaseAuthGuard } from './supabase-auth.guard';

function run(headers: Record<string, string>, identity: { authenticate: jest.Mock }, bypass = true, assertActive: jest.Mock = jest.fn()) {
  const request: Record<string, unknown> = { headers, query: {} };
  const db = { isDevAuthBypassEnabled: () => bypass, verifyToken: jest.fn(), getAdminFallbackEmail: () => 'x@y.z', getAdminUserId: async () => null };
  const guard = new SupabaseAuthGuard(new Reflector(), db as never, { assertActive } as never, identity as never);
  const ctx = { getHandler: () => function handler() {}, getClass: () => class Controller {}, switchToHttp: () => ({ getRequest: () => request }) } as unknown as ExecutionContext;
  return { request, db, result: guard.canActivate(ctx) };
}

describe('SupabaseAuthGuard with Auth0', () => {
  it('authenticates through IdentityService and hands the database token on as request.accessToken', async () => {
    const identity = { authenticate: jest.fn(async () => ({ user: { id: 'u1', email: 'a@x.com', role: 'authenticated' }, dbToken: 'db-tok', sessionId: 's' })) };
    const { request, db, result } = run({ authorization: 'Bearer auth0-tok' }, identity);
    await expect(result).resolves.toBe(true);
    expect(identity.authenticate).toHaveBeenCalledWith('auth0-tok');
    expect(request).toMatchObject({ user: { id: 'u1' }, accessToken: 'db-tok', sessionId: 's' });
    expect(db.verifyToken).not.toHaveBeenCalled();
  });

  it('applies the inactivity timeout, and an idle session is rejected (never handed to the bypass)', async () => {
    const identity = { authenticate: jest.fn(async () => ({ user: { id: 'u1', email: 'a@x.com', role: 'authenticated' }, dbToken: 'db', sessionId: 'key' })) };
    const idle = new UnauthorizedException('idle');
    const assertActive = jest.fn(async () => { throw idle; });
    await expect(run({ authorization: 'Bearer t' }, identity, true, assertActive).result).rejects.toBe(idle);
    expect(assertActive).toHaveBeenCalledWith('key', 'u1', 't');
  });

  it('never falls back to the dev bypass for a bad token or an uninvited person', async () => {
    for (const error of [new UnauthorizedException('bad'), new ForbiddenException('not invited')]) {
      const identity = { authenticate: jest.fn(async () => { throw error; }) };
      await expect(run({ authorization: 'Bearer t' }, identity, true).result).rejects.toBe(error);
    }
  });
});
