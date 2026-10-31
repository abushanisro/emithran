import { type ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { type Reflector } from '@nestjs/core';

import { SupabaseAuthGuard } from '../../../common/guards/supabase-auth.guard';
import { type SessionActivityService } from '../../../common/session/session-activity.service';
import { type SupabaseService } from '../../../common/supabase/supabase.service';
import { type AuthenticatedRequestUser, type IdentityService } from '../../../modules/auth/identity.service';

/** The guard only calls these few methods; the fakes implement exactly them. */
const fake = <T>(impl: Partial<T>): T => impl as T;

interface Request {
  headers: Record<string, string | undefined>;
  query?: Record<string, string>;
  user?: unknown;
  accessToken?: string;
  sessionId?: string;
}

const AUTH0_USER: AuthenticatedRequestUser = {
  user: { id: 'user-1', email: 'a@acme.com', role: 'authenticated' },
  dbToken: 'db-token-for-user-1',
  sessionId: 'sid-1',
};

function setup(opts: { isPublic?: boolean; bypass?: boolean; adminUserId?: jest.Mock; authenticate?: jest.Mock; assertActive?: jest.Mock } = {}) {
  const authenticate = opts.authenticate ?? jest.fn().mockResolvedValue(AUTH0_USER);
  const assertActive = opts.assertActive ?? jest.fn().mockResolvedValue({ lastActivityAt: 0, lastJobAt: null });
  const getAdminUserId = opts.adminUserId ?? jest.fn().mockResolvedValue('admin-1');
  const mintDbUserToken = jest.fn((id: string) => `db-token-for-${id}`);
  const guard = new SupabaseAuthGuard(
    fake<Reflector>({ getAllAndOverride: jest.fn().mockReturnValue(opts.isPublic ?? false) }),
    fake<SupabaseService>({
      isDevAuthBypassEnabled: () => opts.bypass ?? false,
      getAdminFallbackEmail: () => 'dev@acme.com',
      getAdminUserId,
      mintDbUserToken,
    }),
    fake<SessionActivityService>({ assertActive }),
    fake<IdentityService>({ authenticate }),
  );
  const run = (request: Request) =>
    guard.canActivate(
      fake<ExecutionContext>({
        getHandler: () => () => undefined,
        getClass: <T>() => class {} as T,
        switchToHttp: () => fake<ReturnType<ExecutionContext['switchToHttp']>>({ getRequest: <T>() => request as T }),
      }),
    );
  return { run, authenticate, assertActive, getAdminUserId, mintDbUserToken };
}

describe('SupabaseAuthGuard (Auth0)', () => {
  it('lets public routes through without a token', async () => {
    const { run, authenticate } = setup({ isPublic: true });
    await expect(run({ headers: {} })).resolves.toBe(true);
    expect(authenticate).not.toHaveBeenCalled();
  });

  it('authenticates a bearer token through Auth0, checks the idle deadline, and attaches the database token', async () => {
    const { run, authenticate, assertActive } = setup();
    const request: Request = { headers: { authorization: 'Bearer auth0-token' } };

    await expect(run(request)).resolves.toBe(true);

    expect(authenticate).toHaveBeenCalledWith('auth0-token');
    expect(assertActive).toHaveBeenCalledWith('sid-1', 'user-1');
    expect(request).toMatchObject({ user: AUTH0_USER.user, accessToken: 'db-token-for-user-1', sessionId: 'sid-1' });
  });

  it('rejects an invalid token even with the development bypass on: the bypass never rescues a bad token', async () => {
    const { run, getAdminUserId } = setup({ bypass: true, authenticate: jest.fn().mockRejectedValue(new UnauthorizedException()) });
    await expect(run({ headers: { authorization: 'Bearer forged' } })).rejects.toBeInstanceOf(UnauthorizedException);
    expect(getAdminUserId).not.toHaveBeenCalled();
  });

  it('rejects an idle session', async () => {
    const { run } = setup({ assertActive: jest.fn().mockRejectedValue(new UnauthorizedException('idle')) });
    await expect(run({ headers: { authorization: 'Bearer auth0-token' } })).rejects.toThrow('idle');
  });

  it('no longer accepts a token in the query string', async () => {
    const { run, authenticate } = setup();
    await expect(run({ headers: {}, query: { token: 'auth0-token' } })).rejects.toBeInstanceOf(UnauthorizedException);
    expect(authenticate).not.toHaveBeenCalled();
  });

  it('rejects a request without a token when the development bypass is off (always so in production)', async () => {
    const { run, getAdminUserId } = setup({ bypass: false });
    await expect(run({ headers: {} })).rejects.toBeInstanceOf(UnauthorizedException);
    expect(getAdminUserId).not.toHaveBeenCalled();
  });

  it('with the bypass on, acts as the configured account through RLS with a database token for that account', async () => {
    const { run, mintDbUserToken } = setup({ bypass: true });
    const request: Request = { headers: {} };

    await expect(run(request)).resolves.toBe(true);

    expect(request).toMatchObject({ user: { id: 'admin-1', email: 'dev@acme.com' }, accessToken: 'db-token-for-admin-1' });
    expect(mintDbUserToken).toHaveBeenCalledWith('admin-1', { email: 'dev@acme.com' });
  });

  it('rejects when the bypass account cannot be found, and looks it up again on the next request', async () => {
    const getAdminUserId = jest.fn().mockResolvedValueOnce(null).mockResolvedValueOnce('admin-1');
    const { run } = setup({ bypass: true, adminUserId: getAdminUserId });

    await expect(run({ headers: {} })).rejects.toBeInstanceOf(UnauthorizedException);
    await expect(run({ headers: {} })).resolves.toBe(true);
    expect(getAdminUserId).toHaveBeenCalledTimes(2);
  });
});
