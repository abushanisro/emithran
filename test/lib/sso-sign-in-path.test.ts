import { describe, expect, it } from 'vitest';

import { ssoConnection, ssoSignInPath } from '@/lib/providers/auth0-auth-provider';

/** "Sign in with SSO" goes straight to the company's Auth0 enterprise connection, and never to a public social login. */
describe('SSO sign-in', () => {
  it('uses the configured enterprise connection', () => {
    expect(ssoConnection('emithran-auth')).toBe('emithran-auth');
    expect(ssoSignInPath('emithran-auth')).toBe('/auth/login?connection=emithran-auth');
  });

  it('has no connection, and so no button, when none is configured: no fallback to Google social login', () => {
    expect(ssoConnection(undefined)).toBeNull();
    expect(ssoConnection('')).toBeNull();
    expect(ssoConnection('   ')).toBeNull();
  });

  it('encodes the connection name', () => {
    expect(ssoSignInPath('a&b')).toBe('/auth/login?connection=a%26b');
  });
});
