import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';

import { describe, expect, it, vi } from 'vitest';

import { onExecutePostLogin } from '@/infra/auth0/company-google-login';

// The Auth0 post-login Action behind "Sign in with SSO": a Google sign-in is let through only for the company domains listed in the
// Action secret ALLOWED_GOOGLE_DOMAINS. The invite list (authorized_users) still decides who gets into the app.
const read = (file: string) => fs.readFileSync(path.resolve(process.cwd(), file), 'utf8');

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

  // Auth0 runs JavaScript: what the setup script uploads is this file compiled to CommonJS, so the compiled output must work too.
  it('still works once compiled the way the setup script uploads it', async () => {
    const out = fs.mkdtempSync(path.join(os.tmpdir(), 'auth0-action-'));
    execFileSync('npx', ['tsc', '--module', 'commonjs', '--target', 'es2022', '--skipLibCheck', '--outDir', out, 'infra/auth0/company-google-login.ts']);
    expect(read('infra/auth0/setup-company-google-sso.sh')).toContain('npx tsc --module commonjs --target es2022 --skipLibCheck --outDir "$tmp" "$src"');
    fs.writeFileSync(path.join(out, 'package.json'), '{"type":"commonjs"}');
    const compiled = createRequire(import.meta.url)(path.join(out, 'company-google-login.js')) as { onExecutePostLogin: typeof onExecutePostLogin };
    const deny = vi.fn();
    const event = (email: string) => ({ connection: { strategy: 'google-oauth2' }, user: { email, email_verified: true }, secrets: { ALLOWED_GOOGLE_DOMAINS: 'emuski.com' } });
    await compiled.onExecutePostLogin(event('a@emuski.com'), { access: { deny } });
    expect(deny).not.toHaveBeenCalled();
    await compiled.onExecutePostLogin(event('a@gmail.com'), { access: { deny } });
    expect(deny).toHaveBeenCalledOnce();
  });
});
