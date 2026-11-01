import { describe, expect, it } from 'vitest';

import { googleSignInPath } from '@/lib/providers/auth0-auth-provider';

/** "Sign in with Google" goes straight to one Auth0 connection: a company's Google Workspace, or Auth0's Google social login by default. */
describe('Google sign-in path', () => {
  it('uses the configured Google Workspace connection', () => {
    expect(googleSignInPath('emithran-auth')).toBe('/auth/login?connection=emithran-auth');
  });

  it("falls back to Auth0's Google social connection", () => {
    expect(googleSignInPath(undefined)).toBe('/auth/login?connection=google-oauth2');
  });

  it('encodes the connection name', () => {
    expect(googleSignInPath('a&b')).toBe('/auth/login?connection=a%26b');
  });
});
