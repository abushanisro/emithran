import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

// Runs infra/auth0/setup-email.sh against the fake `auth0` CLI (test/auth0/fixtures/auth0) and checks what it would send to Auth0.
let lastStderr = '';
function run(env: Record<string, string> = {}) {
  const log = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'auth0-email-')), 'writes.log');
  fs.writeFileSync(log, '');
  const bin = path.dirname(path.resolve('test/auth0/fixtures/auth0'));
  const result = spawnSync('infra/auth0/setup-email.sh', {
    input: 'abcd efgh ijkl mnop\n',
    env: { ...process.env, ...env, PATH: `${bin}:${process.env.PATH ?? ''}`, FAKE_LOG: log },
    stdio: ['pipe', 'ignore', 'pipe'],
    encoding: 'utf8',
  });
  if (result.status !== 0) throw new Error(`setup-email.sh failed: ${result.stderr}`);
  lastStderr = result.stderr;
  return fs.readFileSync(log, 'utf8').trim().split('\n').filter(Boolean).map((line) => {
    const [method, url, ...body] = line.split(' ');
    return { method, url, body: JSON.parse(body.join(' ')) as Record<string, unknown> };
  });
}

describe('infra/auth0/setup-email.sh', () => {
  const writes = run();

  it('sends Auth0 mail through the Google Workspace mailbox (app password without its spaces)', () => {
    expect(writes.find((w) => w.url === 'emails/provider')?.body).toEqual({
      name: 'smtp',
      enabled: true,
      default_from_address: 'contact@emithran.com',
      credentials: { smtp_host: 'smtp.gmail.com', smtp_port: 587, smtp_user: 'contact@emithran.com', smtp_pass: 'abcdefghijklmnop' },
    });
  });

  it('uses the EMITHRAN password-reset email, with the reset link and a 1-hour lifetime', () => {
    const t = writes.find((w) => w.url === 'email-templates')?.body;
    expect(t).toMatchObject({ template: 'reset_email', enabled: true, syntax: 'liquid', from: 'EMITHRAN <contact@emithran.com>', subject: 'Reset your EMITHRAN password', urlLifetimeInSeconds: 3600 });
    expect(t?.body).toContain('href="{{ url }}"');
    expect(t?.body).toContain('EMITHRAN');
    // the EMITHRAN logo from the app itself (a small copy), never an Auth0 image
    expect(t?.body).toContain('src="https://app.emithran.com/email-logo.png"');
    expect(t?.body).not.toContain('auth0.com');
    expect(fs.existsSync('public/email-logo.png')).toBe(true);
  });

  // Without this tenant flag Auth0 builds the reset link on dev-ahu0oilgxwkz8hhf.us.auth0.com instead of auth.emithran.com.
  it('puts the custom domain (auth.emithran.com) into email links', () => {
    expect(writes.find((w) => w.url === 'tenants/settings')?.body).toEqual({ flags: { enable_custom_domain_in_emails: true } });
  });

  it('changes nothing in a dry run', () => {
    expect(run({ DRY_RUN: '1' })).toEqual([]);
  });

  // First run on a tenant: Auth0 answers "not found" for the provider and the template. The script creates both, quietly.
  it('creates the provider and the template when Auth0 has neither, without errors', () => {
    const fresh = run({ FAKE_NOT_FOUND: '1' });
    expect(fresh.map((w) => [w.method, w.url].join(" "))).toEqual(['post emails/provider', 'post email-templates', 'patch tenants/settings']);
    expect(lastStderr).not.toMatch(/Traceback|Error/);
  });
});
