import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

// Runs the real setup script against a fake `auth0` CLI (test/auth0/fixtures/auth0) and checks what it would send to Auth0.
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'auth0-setup-'));
const log = path.join(dir, 'writes.log');
const bin = path.dirname(path.resolve('test/auth0/fixtures/auth0'));
execFileSync('infra/auth0/setup-company-google-sso.sh', {
  input: 'cid.apps.googleusercontent.com\nGOCSPX-test\n',
  env: { ...process.env, PATH: `${bin}:${process.env.PATH ?? ''}`, FAKE_LOG: log },
  stdio: ['pipe', 'ignore', 'pipe'],
});
const writes = fs.readFileSync(log, 'utf8').trim().split('\n').map((line) => {
  const [method, url, ...body] = line.split(' ');
  return { method, url, body: JSON.parse(body.join(' ') || 'null') as Record<string, unknown> | null };
});
const write = (url: string) => writes.find((w) => w.url === url);

describe('infra/auth0/setup-company-google-sso.sh', () => {
  it('gives the Google connection our key and always shows the account chooser, keeping its other options', () => {
    const options = write('connections/con_G')?.body?.options as Record<string, unknown>;
    expect(options).toMatchObject({ client_id: 'cid.apps.googleusercontent.com', client_secret: 'GOCSPX-test', scope: ['email', 'profile'] });
    expect(options.upstream_params).toEqual({ prompt: { value: 'select_account' } });
  });

  it('runs the domain rule first and keeps the existing post-login Actions', () => {
    const bindings = (write('actions/triggers/post-login/bindings')?.body?.bindings ?? []) as { display_name: string }[];
    expect(bindings.map((b) => b.display_name)).toEqual(['company-google-login', 'emithran-claims']);
  });

  it('turns Google on for the apps only after the rule is deployed and attached', () => {
    const order = writes.map((w) => w.url);
    expect(order.indexOf('actions/actions/act_1/deploy')).toBeLessThan(order.indexOf('actions/triggers/post-login/bindings'));
    expect(order.indexOf('actions/triggers/post-login/bindings')).toBeLessThan(order.indexOf('connections/con_G/clients'));
    expect(write('connections/con_G/clients')?.body).toEqual([
      { client_id: 'KVp4wXDVKV4fNARjMkDfehdfx7xCPoiR', status: true },
      { client_id: 'yfh7DddWUI3e9KIhmcpEhRCBMz3ARONs', status: true },
    ]);
  });
});
