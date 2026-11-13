import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

// scripts/smoke.sh decides whether a deployment is healthy: every check must really fail when its condition breaks (a smoke test that always
// passes is worse than none). It runs against a fake curl so each failure can be produced on demand. stage-release.sh must refuse unsafe input
// before it changes anything.
const root = process.cwd();
const smoke = path.join(root, 'scripts/smoke.sh');
const site = 'https://site.test';
let bin: string;

beforeAll(() => {
  bin = fs.mkdtempSync(path.join(os.tmpdir(), 'smoke-bin-'));
  fs.writeFileSync(path.join(bin, 'curl'), `#!/usr/bin/env bash
u=; w=; d=0; prev=
for a in "$@"; do case "$a" in http*) u="$a";; esac; [ "$prev" = -w ] && w="$a"; [ "$prev" = -D ] && d=1; prev="$a"; done
p="\${u#${site}}"
code_of() { case "$p" in /api/health/ready) echo "\${READY_CODE:-200}";; /auth/login) echo "\${LOGIN_CODE:-307}";; /) echo "\${HOME_CODE:-200}";; /api/v1/projects) if [ -n "$HAS_COOKIE" ]; then echo "\${PROJ_CODE:-200}"; else echo "\${API_CODE:-401}"; fi;; esac; }
for a in "$@"; do case "$a" in Cookie:*) HAS_COOKIE=1;; esac; done
if [ "$d" = 1 ]; then
  printf 'HTTP/2 %s\\r\\n' "$(code_of)"
  [ "$p" = /auth/login ] && printf 'location: %s\\r\\n' "\${LOGIN_LOC:-https://auth.test/authorize?redirect_uri=https%3A%2F%2Fsite.test%2Fauth%2Fcallback}"
  [ "$p" = / ] && printf 'content-security-policy: %s\\r\\n' "\${CSP:-default-src 'self'; script-src 'self' 'nonce-abc'}"
  exit 0
fi
[ "$p" = /api/health/ready ] && body="\${READY_BODY:-{\\"status\\":\\"ok\\"}}" || body=
case "$w" in *'%{http_code}'*) printf '%s%s' "$body" "\${w//%\\{http_code\\}/$(code_of)}";; esac
`, { mode: 0o755 });
});
afterAll(() => fs.rmSync(bin, { recursive: true, force: true }));

const runSmoke = (env: Record<string, string> = {}) => {
  const r = spawnSync('bash', [smoke, site], { env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, ...env }, encoding: 'utf8' });
  return { status: r.status, out: `${r.stdout}${r.stderr}` };
};

describe('scripts/smoke.sh', () => {
  it('passes on a healthy site', () => {
    const r = runSmoke();
    expect(r.status).toBe(0);
    expect(r.out).toContain('SMOKE OK');
  });

  it.each([
    ['readiness is 503', { READY_CODE: '503', READY_BODY: '{"status":"unavailable"}' }, 'ready'],
    ['readiness address is missing (an HTML page)', { READY_BODY: '<html>not found</html>', READY_CODE: '404' }, 'ready'],
    ['the sign-in redirect points at another site', { LOGIN_LOC: 'https://auth.test/authorize?redirect_uri=https%3A%2F%2Fother.test%2Fauth%2Fcallback' }, 'login'],
    ['the sign-in does not redirect', { LOGIN_CODE: '500' }, 'login'],
    ['the home page is down', { HOME_CODE: '502' }, 'home'],
    ['the CSP names a retired host', { CSP: "default-src 'self'; connect-src https://x.railway.app 'nonce-abc'" }, 'CSP'],
    ['the CSP has no nonce', { CSP: "default-src 'self'" }, 'CSP'],
    ['the data API answers a visitor', { API_CODE: '200' }, 'auth wall'],
  ])('fails when %s', (_label, env, check) => {
    const r = runSmoke(env);
    expect(r.status).toBeGreaterThan(0);
    expect(r.out).toMatch(new RegExp(`FAIL  ${check}`));
  });

  it('checks a signed-in session when given a cookie file, and fails on an expired one', () => {
    const cookie = path.join(bin, 'cookie'); fs.writeFileSync(cookie, 'appSession=x');
    expect(runSmoke({ SMOKE_COOKIE_FILE: cookie }).out).toContain('PASS  signed in');
    const r = runSmoke({ SMOKE_COOKIE_FILE: cookie, PROJ_CODE: '401' });
    expect(r.status).toBe(1);
    expect(r.out).toContain('FAIL  signed in');
  });
});

describe('infra/oracle/stage-release.sh', () => {
  // The sand-casting worker is part of staging when the settings name its socket: compose profile on, and the worker in the service list
  // (built, tagged good-<sha> for rollback, recreated with the rest).
  it('runs the casting worker when the settings name its socket', () => {
    const text = fs.readFileSync(path.join(root, 'infra/oracle/stage-release.sh'), 'utf8');
    expect(text).toMatch(/grep -qE '\^CASTING_WORKER_SOCKET=\.\+' "\$ENV_FILE"; then profile="--profile sand-casting"; services="\$services casting-worker"/);
    expect(text).toMatch(/docker compose -p "\$P" \$profile -f docker-compose.prod.yml/);
    expect(fs.readFileSync(path.join(root, 'env/stage.env.example'), 'utf8')).toMatch(/^CASTING_WORKER_SOCKET=\/run\/casting-worker\/worker.sock$/m);
  });

  const script = path.join(root, 'infra/oracle/stage-release.sh');
  const sh = (args: string[], env: Record<string, string> = {}) => {
    const r = spawnSync('bash', [script, ...args], { env: { ...process.env, ...env }, encoding: 'utf8' });
    return { status: r.status, out: `${r.stdout}${r.stderr}` };
  };

  it('refuses an unknown ref', () => {
    const r = sh(['no-such-ref-xyz']);
    expect(r.status).toBe(2);
    expect(r.out).toContain('unknown git ref');
  });

  it('refuses a settings file that is not staging\'s, before changing anything', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'stage-env-'));
    const env = path.join(dir, 'prd.env'); fs.writeFileSync(env, 'APP_ENV=prd\n');
    const ref = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
    const r = sh([ref], { STAGE_ENV: env, STAGE_DIR: path.join(dir, 'emithran-stage-run') });
    fs.rmSync(dir, { recursive: true, force: true });
    // a checkout that predates smoke.sh is refused for that reason first; either way nothing was changed
    expect(r.status).toBe(2);
    expect(r.out).toMatch(/APP_ENV=stage|does not contain/);
  });

  it('refuses a release folder that is not the dedicated one (it is emptied on each release)', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'stage-env-'));
    const env = path.join(dir, 'stage.env'); fs.writeFileSync(env, 'APP_ENV=stage\n');
    const ref = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
    const r = sh([ref], { STAGE_ENV: env, STAGE_DIR: path.join(dir, 'home') });
    fs.rmSync(dir, { recursive: true, force: true });
    expect(r.status).toBe(2);
    expect(r.out).toMatch(/emithran-stage-run|does not contain/);
  });
});
