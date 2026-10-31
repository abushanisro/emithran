import { AuthorizationError, InvalidStateError, OAuth2Error } from '@auth0/nextjs-auth0/errors';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type * as Auth0Server from '@auth0/nextjs-auth0/server';
import type { Auth0ClientOptions, SessionData } from '@auth0/nextjs-auth0/types';

const constructed: Auth0ClientOptions[] = [];
vi.mock('@auth0/nextjs-auth0/server', async (importOriginal) => ({
  ...(await importOriginal<typeof Auth0Server>()),
  // Records the options instead of building a real client, which would need a full Auth0 configuration.
  Auth0Client: vi.fn(function record(options: Auth0ClientOptions) {
    constructed.push(options);
  }),
}));

async function options(): Promise<Auth0ClientOptions> {
  vi.resetModules();
  constructed.length = 0;
  vi.stubEnv('AUTH0_AUDIENCE', 'https://api.example.com');
  (await import('@/lib/auth0')).getAuth0();
  const built = constructed[0];
  if (!built) throw new Error('Auth0Client was not constructed');
  return built;
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('Auth0 client options', () => {
  it('turns off the /auth/access-token endpoint, so browser JavaScript cannot fetch a token', async () => {
    expect((await options()).enableAccessTokenEndpoint).toBe(false);
  });

  it("keeps the default profile claims plus the session id, which the idle timer uses instead of the token's sid", async () => {
    const { beforeSessionSaved } = await options();
    if (!beforeSessionSaved) throw new Error('beforeSessionSaved is not set');
    const session: SessionData = {
      user: { sub: 'auth0|1', email: 'a@example.com', name: 'A', sid: 'from-the-id-token', nonce: 'n', at_hash: 'h' },
      tokenSet: { accessToken: 'at', expiresAt: 0 },
      internal: { sid: 'sid-1', createdAt: 0 },
    };
    const saved = await beforeSessionSaved(session, null);
    expect(saved.user).toEqual({ sub: 'auth0|1', email: 'a@example.com', name: 'A', sid: 'sid-1' });
    expect(saved.tokenSet).toBe(session.tokenSet);
  });
});

describe('Auth0 sign-in callback', () => {
  async function onCallback() {
    vi.stubEnv('APP_BASE_URL', 'https://app.example.com');
    const hook = (await options()).onCallback;
    if (!hook) throw new Error('onCallback is not set');
    return hook;
  }

  it('sends a reused or expired sign-in link back to the sign-in page', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const res = await (await onCallback())(new InvalidStateError(), {}, null);
    expect(res.headers.get('location')).toBe('https://app.example.com/auth?error=invalid_state');
  });

  it("sends an Auth0 refusal back to the sign-in page, logging Auth0's message instead of putting it in the URL", async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const cause = new OAuth2Error({ code: 'invalid_request', message: 'Client "abc" is not authorized to access resource server' });
    const res = await (await onCallback())(new AuthorizationError({ cause }), { appBaseUrl: 'https://app.example.com' }, null);
    expect(res.headers.get('location')).toBe('https://app.example.com/auth?error=authorization_error');
    expect(log).toHaveBeenCalledWith(expect.stringContaining('not authorized to access resource server'));
  });

  it('sends a successful sign-in to the page it started from', async () => {
    const res = await (await onCallback())(null, { appBaseUrl: 'https://app.example.com', returnTo: '/projects' }, null);
    expect(res.headers.get('location')).toBe('https://app.example.com/projects');
  });

  it('never leaves the app after sign-in, even for a protocol-relative return path', async () => {
    const res = await (await onCallback())(null, { appBaseUrl: 'https://app.example.com', returnTo: '//evil.example' }, null);
    expect(res.headers.get('location')).toBe('https://app.example.com/');
  });
});
