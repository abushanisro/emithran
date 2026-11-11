import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { loadYaml } from './load-yaml';

// The outside uptime monitor must stay what it says it is: every 5 minutes, no permissions, no secrets, watching the public site, and its probe logic
// must really fail on a bad status (a monitor that always passes is worse than none).
const text = fs.readFileSync(path.resolve(process.cwd(), '.github/workflows/uptime.yml'), 'utf8');
const wf = loadYaml(text) as { on: { schedule: { cron: string }[] }; permissions: unknown; jobs: { check: { steps: { run?: string; env?: Record<string, string> }[] } } };

describe('.github/workflows/uptime.yml', () => {
  it('runs every 5 minutes with no permissions and no secrets', () => {
    expect(wf.on.schedule).toEqual([{ cron: '*/5 * * * *' }]);
    expect(wf.permissions).toEqual({});
    expect(text).not.toMatch(/secrets\./);
  });

  it('watches the public site: the readiness address and the sign-in redirect', () => {
    const step = wf.jobs.check.steps[0];
    expect(step?.env?.SITE).toBe('https://app.emithran.com');
    expect(step?.run).toContain('$SITE/api/health/ready');
    expect(step?.run).toContain('$SITE/auth/login');
  });

  // Runs the real probe function against a fake curl, so the decision logic itself is tested.
  const run = (statuses: Record<string, string>) => {
    const step = wf.jobs.check.steps[0]?.run ?? '';
    const script = `curl() { for a in "$@"; do case "$a" in http*) u="$a";; esac; done; case "$u" in ${Object.entries(statuses).map(([k, v]) => `*${k}) printf '${v}';;`).join(' ')} esac; }\nexport SITE=https://app.emithran.com\n${step}`;
    try { execFileSync('bash', ['-c', script], { stdio: 'pipe' }); return 0; } catch (e) { return (e as { status: number }).status; }
  };

  it('passes when everything answers as expected', () => {
    expect(run({ '/api/health/ready': '200', '/auth/login': '307' })).toBe(0);
  });

  it('tolerates a release that predates the readiness address (404), and nothing else', () => {
    expect(run({ '/api/health/ready': '404', '/auth/login': '307' })).toBe(0);
  });

  it.each([
    ['the database or an engine is down (503)', { '/api/health/ready': '503', '/auth/login': '307' }],
    ['the site does not answer at all', { '/api/health/ready': '000', '/auth/login': '000' }],
    ['the sign-in redirect breaks', { '/api/health/ready': '200', '/auth/login': '502' }],
    ['the sign-in answers 200 instead of redirecting', { '/api/health/ready': '200', '/auth/login': '200' }],
  ])('fails when %s', (_label, statuses) => {
    expect(run(statuses)).toBe(1);
  });
});
