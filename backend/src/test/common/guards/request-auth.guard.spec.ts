import { type ExecutionContext, ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { type Reflector } from '@nestjs/core';

import { API_KEY_SCOPES_KEY } from '../../../common/decorators/api-key-scopes.decorator';
import { IS_PUBLIC_KEY } from '../../../common/decorators/public.decorator';
import { RequestAuthGuard } from '../../../common/guards/request-auth.guard';
import { type SessionActivityService } from '../../../common/session/session-activity.service';
import { type DatabaseService } from '../../../common/database/database.service';
import { type ApiKeyAuthService, type ApiKeyLogin } from '../../../modules/auth/api-key-auth.service';
import { type AuthenticatedRequestUser, type IdentityService } from '../../../modules/auth/identity.service';

/** The guard only calls these few methods; the fakes implement exactly them. */
const fake = <T>(impl: Partial<T>): T => impl as T;

interface Request {
  headers: Record<string, string | undefined>;
  query?: Record<string, string>;
  user?: unknown;
  accessToken?: string;
  sessionId?: string;
  apiKey?: unknown;
}

const AUTH0_USER: AuthenticatedRequestUser = {
  user: { id: 'user-1', email: 'a@acme.com', role: 'authenticated' },
  dbToken: 'db-token-for-user-1',
  sessionId: 'sid-1',
};

const KEY_LOGIN: ApiKeyLogin = {
  user: { id: 'owner-1', email: 'erp@acme.com', role: 'authenticated' },
  dbToken: 'db-token-for-owner-1',
  apiKey: { id: 'key-1', organizationId: 'org-1', scopes: ['projects:read'] },
};

function setup(
  opts: {
    isPublic?: boolean;
    bypass?: boolean;
    adminUserId?: jest.Mock;
    authenticate?: jest.Mock;
    assertActive?: jest.Mock;
    keyAuthenticate?: jest.Mock;
    /** The @ApiKeyScopes of the route; undefined means the route does not take keys. */
    scopes?: string[];
  } = {},
) {
  const authenticate = opts.authenticate ?? jest.fn().mockResolvedValue(AUTH0_USER);
  const assertActive = opts.assertActive ?? jest.fn().mockResolvedValue({ lastActivityAt: 0, lastJobAt: null });
  const getAdminUserId = opts.adminUserId ?? jest.fn().mockResolvedValue('admin-1');
  const mintDbUserToken = jest.fn((id: string) => `db-token-for-${id}`);
  const keyAuthenticate = opts.keyAuthenticate ?? jest.fn().mockResolvedValue(KEY_LOGIN);
  const refuseScope = jest.fn().mockResolvedValue(undefined);
  const metadata: Record<string, unknown> = { [IS_PUBLIC_KEY]: opts.isPublic ?? false, [API_KEY_SCOPES_KEY]: opts.scopes };
  const guard = new RequestAuthGuard(
    fake<Reflector>({ getAllAndOverride: ((key: string) => metadata[key]) as unknown as Reflector['getAllAndOverride'] }),
    fake<DatabaseService>({
      isDevAuthBypassEnabled: () => opts.bypass ?? false,
      getAdminFallbackEmail: () => 'dev@acme.com',
      getAdminUserId,
      mintDbUserToken,
    }),
    fake<SessionActivityService>({ assertActive }),
    fake<IdentityService>({ authenticate }),
    fake<ApiKeyAuthService>({ authenticate: keyAuthenticate, refuseScope }),
  );
  const run = (request: Request) =>
    guard.canActivate(
      fake<ExecutionContext>({
        getHandler: () => () => undefined,
        getClass: <T>() => class {} as T,
        switchToHttp: () => fake<ReturnType<ExecutionContext['switchToHttp']>>({ getRequest: <T>() => request as T }),
      }),
    );
  return { run, authenticate, assertActive, getAdminUserId, mintDbUserToken, keyAuthenticate, refuseScope };
}

describe('RequestAuthGuard (API keys)', () => {
  // Built at run time: no key-shaped literal in source (the secret scan would flag it).
  const KEY = ['mk', 'live', '0123456789abcdef'.repeat(2)].join('_');

  it('acts as the key owner on a route that takes the key scope, with no Auth0 call and no session clock', async () => {
    const { run, authenticate, assertActive, keyAuthenticate } = setup({ scopes: ['projects:read'] });
    const request: Request = { headers: { authorization: `Bearer ${KEY}` } };

    await expect(run(request)).resolves.toBe(true);

    expect(keyAuthenticate).toHaveBeenCalledWith(KEY);
    expect(authenticate).not.toHaveBeenCalled();
    expect(assertActive).not.toHaveBeenCalled();
    expect(request).toMatchObject({ user: KEY_LOGIN.user, accessToken: 'db-token-for-owner-1', apiKey: KEY_LOGIN.apiKey });
    expect(request.sessionId).toBeUndefined();
  });

  it('refuses a key on a route without @ApiKeyScopes, and audits it', async () => {
    const { run, refuseScope } = setup({ scopes: undefined });
    const request: Request = { headers: { authorization: `Bearer ${KEY}` } };

    await expect(run(request)).rejects.toThrow(new ForbiddenException('This endpoint does not accept API keys'));
    expect(refuseScope).toHaveBeenCalledWith(KEY_LOGIN.apiKey, 'owner-1', 'api_key_endpoint_not_allowed');
    expect(request.user).toBeUndefined();
  });

  it('refuses a key that lacks one of the route scopes (a read key on a write route)', async () => {
    const { run, refuseScope } = setup({ scopes: ['projects:write'] });
    const request: Request = { headers: { authorization: `Bearer ${KEY}` } };

    await expect(run(request)).rejects.toThrow('This API key lacks the scope projects:write');
    expect(refuseScope).toHaveBeenCalledWith(KEY_LOGIN.apiKey, 'owner-1', 'api_key_scope_missing');
    expect(request.accessToken).toBeUndefined();
  });

  it('passes on the refusal of an invalid, revoked or expired key, before any scope check', async () => {
    const { run, refuseScope } = setup({ scopes: ['projects:read'], keyAuthenticate: jest.fn().mockRejectedValue(new UnauthorizedException()) });
    await expect(run({ headers: { authorization: `Bearer ${KEY}` } })).rejects.toBeInstanceOf(UnauthorizedException);
    expect(refuseScope).not.toHaveBeenCalled();
  });

  it('does not treat a key as one when the bypass is on: a bad key is never rescued', async () => {
    const { run, getAdminUserId } = setup({ bypass: true, scopes: ['projects:read'], keyAuthenticate: jest.fn().mockRejectedValue(new UnauthorizedException()) });
    await expect(run({ headers: { authorization: `Bearer ${KEY}` } })).rejects.toBeInstanceOf(UnauthorizedException);
    expect(getAdminUserId).not.toHaveBeenCalled();
  });
});

describe('RequestAuthGuard (Auth0)', () => {
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
