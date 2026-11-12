import { describe, expect, it } from 'vitest';

import { SIGN_IN_PATH, ssoSignInPath } from '@/lib/auth/sign-in';

/** "Sign in with SSO" goes straight to the company's Auth0 enterprise connection, and never to a public social login. */
describe('sign-in addresses', () => {
  it('signs in through Auth0, and through the configured enterprise connection for SSO', () => {
    expect(SIGN_IN_PATH).toBe('/auth/login');
    expect(ssoSignInPath('emithran-auth')).toBe('/auth/login?connection=emithran-auth');
  });

  it('has no SSO address, and so no button, when no connection is configured: no fallback to Google social login', () => {
    expect(ssoSignInPath(undefined)).toBeNull();
    expect(ssoSignInPath('')).toBeNull();
    expect(ssoSignInPath('   ')).toBeNull();
  });

  it('encodes the connection name', () => {
    expect(ssoSignInPath('a&b')).toBe('/auth/login?connection=a%26b');
  });
});
