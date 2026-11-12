import { describe, expect, it } from 'vitest';

import { SIGN_IN_PATH, ssoSignInPath } from '@/lib/auth/sign-in';

/** "Sign in with SSO" goes straight to the company's Auth0 enterprise connection, and never to a public social login. */
describe('sign-in addresses', () => {
  // Someone clicking a sign-in button is not signed in to the app, so Auth0 must ask (password form, or Google's account chooser)
  // instead of silently reusing a leftover Auth0 session for whoever signed in there last.
  it('signs in through Auth0, always asking, and through the configured connection for SSO', () => {
    // Naming the password connection makes Auth0 show only the email + password form, without its "Continue with Google" button.
    expect(SIGN_IN_PATH).toBe('/auth/login?prompt=login&connection=Username-Password-Authentication');
    expect(ssoSignInPath('emithran-auth')).toBe('/auth/login?prompt=login&connection=emithran-auth');
  });

  it('has no SSO address, and so no button, when no connection is configured: no fallback to Google social login', () => {
    expect(ssoSignInPath(undefined)).toBeNull();
    expect(ssoSignInPath('')).toBeNull();
    expect(ssoSignInPath('   ')).toBeNull();
  });

  it('encodes the connection name', () => {
    expect(ssoSignInPath('a&b')).toBe('/auth/login?prompt=login&connection=a%26b');
  });
});
