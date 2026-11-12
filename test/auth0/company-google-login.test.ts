import { createRequire } from 'node:module';

import { describe, expect, it, vi } from 'vitest';

// The Auth0 post-login Action behind "Sign in with SSO": a Google sign-in is let through only for the company domains listed in the
// Action secret ALLOWED_GOOGLE_DOMAINS. The invite list (authorized_users) still decides who gets into the app.
const { onExecutePostLogin } = createRequire(import.meta.url)('../../infra/auth0/company-google-login.cjs') as {
  onExecutePostLogin: (event: unknown, api: unknown) => Promise<void>;
};

async function login(user: { email?: string; email_verified?: boolean }, strategy = 'google-oauth2', domains = 'emithran.com, EMUSKI.com') {
  const deny = vi.fn();
  await onExecutePostLogin({ connection: { strategy }, user, secrets: { ALLOWED_GOOGLE_DOMAINS: domains } }, { access: { deny } });
  return deny.mock.calls.length === 0;
}

describe('company Google sign-in (Auth0 Action)', () => {
  it.each(['contact@emithran.com', 'enquiries@emuski.com', 'Someone@Emuski.com'])('lets %s in', async (email) => {
    expect(await login({ email, email_verified: true })).toBe(true);
  });

  it.each([
    ['a personal Gmail account', { email: 'someone@gmail.com', email_verified: true }],
    ['a look-alike domain', { email: 'x@emuski.com.evil.io', email_verified: true }],
    ['a sub-domain', { email: 'x@mail.emithran.com', email_verified: true }],
    ['an unverified company email', { email: 'contact@emithran.com', email_verified: false }],
    ['no email at all', {}],
  ])('refuses %s', async (_label, user) => {
    expect(await login(user)).toBe(false);
  });

  it('refuses every Google sign-in when no domain is configured (fails closed)', async () => {
    expect(await login({ email: 'contact@emithran.com', email_verified: true }, 'google-oauth2', '')).toBe(false);
  });

  it('leaves email + password and the Workspace connection alone', async () => {
    expect(await login({ email: 'someone@gmail.com', email_verified: false }, 'auth0')).toBe(true);
    expect(await login({ email: 'someone@gmail.com', email_verified: false }, 'google-apps')).toBe(true);
  });
});
