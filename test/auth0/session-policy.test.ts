import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

// Runs infra/auth0/apply-session-policy.sh against the fake `auth0` CLI (test/auth0/fixtures/auth0) and checks what it would send.
function run(env: Record<string, string> = {}) {
  const log = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'auth0-policy-')), 'writes.log');
  fs.writeFileSync(log, '');
  const bin = path.dirname(path.resolve('test/auth0/fixtures/auth0'));
  execFileSync('infra/auth0/apply-session-policy.sh', { env: { ...process.env, ...env, PATH: `${bin}:${process.env.PATH ?? ''}`, FAKE_LOG: log }, stdio: 'pipe' });
  return fs.readFileSync(log, 'utf8').trim().split('\n').filter(Boolean).map((line) => {
    const [method, url, ...body] = line.split(' ');
    return { method, url, body: JSON.parse(body.join(' ')) as Record<string, unknown> };
  });
}

describe('infra/auth0/apply-session-policy.sh', () => {
  const writes = run();

  it.each(['KVp4wXDVKV4fNARjMkDfehdfx7xCPoiR', 'yfh7DddWUI3e9KIhmcpEhRCBMz3ARONs'])('app %s: rotating refresh tokens that end 8 hours after sign-in, code flow only', (id) => {
    const app = writes.find((w) => w.url === `clients/${id}`);
    expect(app?.method).toBe('patch');
    expect(app?.body.refresh_token).toEqual({
      rotation_type: 'rotating',
      expiration_type: 'expiring',
      token_lifetime: 8 * 60 * 60,
      infinite_token_lifetime: false,
      infinite_idle_token_lifetime: true,
      leeway: 60,
    });
    expect(app?.body.grant_types).toEqual(['authorization_code', 'refresh_token']);
  });

  it.each(['https://api.platform.emithran.com', 'https://api.emithran.com'])('API %s: access tokens last 1 hour', (api) => {
    expect(writes.find((w) => w.url === `resource-servers/${encodeURIComponent(api)}`)?.body).toEqual({ token_lifetime: 3600 });
  });

  it('changes nothing in a dry run', () => {
    expect(run({ DRY_RUN: '1' })).toEqual([]);
  });
});
