import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

// Runs infra/auth0/setup-email.sh against the fake `auth0` CLI (test/auth0/fixtures/auth0) and checks what it would send to Auth0.
function run(env: Record<string, string> = {}) {
  const log = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'auth0-email-')), 'writes.log');
  fs.writeFileSync(log, '');
  const bin = path.dirname(path.resolve('test/auth0/fixtures/auth0'));
  execFileSync('infra/auth0/setup-email.sh', {
    input: 'abcd efgh ijkl mnop\n',
    env: { ...process.env, ...env, PATH: `${bin}:${process.env.PATH ?? ''}`, FAKE_LOG: log },
    stdio: ['pipe', 'ignore', 'pipe'],
  });
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
  });

  it('changes nothing in a dry run', () => {
    expect(run({ DRY_RUN: '1' })).toEqual([]);
  });
});
