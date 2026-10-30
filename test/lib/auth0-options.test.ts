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

async function options(bff: string): Promise<Auth0ClientOptions> {
  vi.resetModules();
  constructed.length = 0;
  vi.stubEnv('NEXT_PUBLIC_BFF', bff);
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
  it('turns off the /auth/access-token endpoint when the BFF is on, so the browser cannot fetch a token', async () => {
    expect((await options('on')).enableAccessTokenEndpoint).toBe(false);
  });

  it('keeps the endpoint while the BFF is off, because the browser still calls the API itself', async () => {
    expect((await options('')).enableAccessTokenEndpoint).toBe(true);
  });

  it("keeps the default profile claims plus the session id, which the idle timer uses instead of the token's sid", async () => {
    const { beforeSessionSaved } = await options('on');
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
