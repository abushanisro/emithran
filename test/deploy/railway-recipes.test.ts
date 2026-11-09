import fs from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

// deploy/railway: the scripts and one-off jobs that create and seed a Railway environment's database. These tests keep the pins in step with
// the files the jobs reuse, and keep out the mistakes found while building them (a guard that failed open, a password on a command line).

const ROOT = process.cwd();
const read = (p: string) => fs.readFileSync(path.resolve(ROOT, p), 'utf8');
const provision = read('deploy/railway/provision-postgres.sh');
const seed = read('deploy/railway/seed-environment.sh');
const imageOf = (text: string, pattern: RegExp) => pattern.exec(text)?.[0];

describe('the jobs run the repo\'s own tools on the repo\'s own pinned images', () => {
  it('bootstrap is the same pinned postgres image baseline-load.sh runs its commands in', () => {
    const loader = imageOf(read('backend/scripts/baseline-load.sh'), /postgres:17-alpine@sha256:[0-9a-f]{64}/);
    expect(loader).toBeDefined();
    expect(read('deploy/railway/bootstrap/Dockerfile')).toContain(`FROM ${loader}`);
  });

  it('migrate is the same pinned node image as the backend image, installed the way the backend installs (legacy peer deps)', () => {
    const backend = imageOf(read('backend/Dockerfile'), /node:[0-9a-z.-]+@sha256:[0-9a-f]{64}/);
    const migrate = read('deploy/railway/migrate/Dockerfile');
    expect(backend).toBeDefined();
    expect(migrate).toContain(`FROM ${backend}`);
    expect(migrate).toContain('npm ci --legacy-peer-deps');
    expect(migrate).toContain('scripts/migrate.ts');
  });

  it('the database is Postgres 17 (CI and the nightly pg_dump client), pinned by digest', () => {
    expect(provision).toMatch(/PG_IMAGE="ghcr\.io\/railwayapp-templates\/postgres-ssl:17@sha256:[0-9a-f]{64}"/);
    expect(read('.github/workflows/ops.yml')).toContain('postgres:17-alpine');
  });

  it('both jobs are one-shot', () => {
    for (const job of ['bootstrap', 'migrate']) {
      expect(JSON.parse(read(`deploy/railway/${job}/railway.json`))).toEqual({ deploy: { restartPolicyType: 'NEVER' } });
    }
  });
});

describe('the scripts fail closed and keep secrets off the command line and the screen', () => {
  it('stop on any error, unset variable or failed pipe', () => {
    for (const script of [provision, seed]) expect(script).toMatch(/^set -euo pipefail$/m);
  });

  it('never test railway\'s output with `| grep -q`: grep closes the pipe, railway dies with SIGPIPE, and under pipefail the guard read "nothing there" and carried on', () => {
    for (const script of [provision, seed]) {
      for (const line of script.split('\n').filter((l) => !l.trim().startsWith('#'))) expect(line).not.toMatch(/railway[^|\n]*\|\s*grep\s+-\w*q/);
    }
  });

  it('send the database password through stdin, never as an argument, and show `railway add` output only when it fails (it echoes every variable)', () => {
    expect(provision).toMatch(/openssl rand -hex 24 \| railway variable set POSTGRES_PASSWORD --stdin/);
    expect(provision).not.toMatch(/--variables\s+"?POSTGRES_PASSWORD=/);
    expect(provision).toMatch(/if ! out="\$\(railway add .*2>&1\)"/s);
    expect(seed).toMatch(/if ! out="\$\(railway add --service "\$name" "\$\{vars\[@\]\}" 2>&1\)"/);
  });

  it('refuse production without an explicit confirmation, and give the runner --confirm there', () => {
    expect(seed).toMatch(/CONFIRM_PRODUCTION:-}" = "yes"/);
    expect(seed).toMatch(/production\)[\s\S]*runner_env=prd; runner_flags="--confirm"/);
    expect(seed).toMatch(/staging\) runner_env=stage; runner_flags=""/);
  });

  it('refuse to create a second postgres, and say why a second environment is duplicated instead', () => {
    expect(provision).toMatch(/already has a postgres service/);
    expect(provision).toMatch(/unique per project/);
  });

  it('delete the temporary services and the baseline copy however the script ends, and read success from the log', () => {
    expect(seed).toMatch(/trap cleanup EXIT/);
    expect(seed).toMatch(/railway service delete --service "\$name"/);
    expect(seed).toMatch(/rm -rf "\$work"/);
    expect(seed).toContain('baseline loaded:');
    expect(seed).toMatch(/pending.*applied/s);
  });

  it('keep the database off the public internet: no TCP proxy, no public URL', () => {
    for (const script of [provision, seed]) {
      expect(script).not.toMatch(/tcp-proxy\s+(create|add|new)/);
      expect(script).not.toContain('DATABASE_PUBLIC_URL');
    }
    expect(seed).toContain('${{postgres.DATABASE_URL}}');
  });
});

describe('deploy/railway holds no data', () => {
  it('has no dump, csv, checksum or env file: the baseline is copied into a temporary folder only', () => {
    const files: string[] = [];
    const walk = (dir: string) => fs.readdirSync(dir, { withFileTypes: true }).forEach((e) => (e.isDirectory() ? walk(path.join(dir, e.name)) : files.push(e.name)));
    walk(path.resolve(ROOT, 'deploy/railway'));
    expect(files.length).toBeGreaterThan(5);
    for (const f of files) expect(f).not.toMatch(/\.(dump|csv|env)$|^SHA256SUMS$|^counts\.txt$/);
  });
});
