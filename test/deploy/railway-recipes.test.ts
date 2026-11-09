import fs from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

// deploy/railway: the scripts and one-off jobs that create and seed a Railway environment's database. These tests keep the pins in step with
// the files the jobs reuse, and keep out the mistakes found while building them (a guard that failed open, a password on a command line).

const ROOT = process.cwd();
const read = (p: string) => fs.readFileSync(path.resolve(ROOT, p), 'utf8');
const provision = read('deploy/railway/provision-postgres.sh');
const seed = read('deploy/railway/seed-environment.sh');
const common = read('deploy/railway/common.sh');
const dataApi = read('deploy/railway/deploy-data-api.sh');
const engine = read('deploy/railway/deploy-engine.sh');
const scripts = { provision, seed, common, dataApi, engine };
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
    for (const [name, script] of Object.entries(scripts)) {
      if (name !== 'common') expect(script, name).toMatch(/^set -E?euo pipefail$/m);
    }
  });

  it('say where they stopped: every script that exits on error installs the ERR trap from common.sh, so a failure is never silent (a SIGPIPE once made a script exit with no message)', () => {
    expect(common).toMatch(/on_error\(\) \{ echo "error: \$\(basename "\$0"\) stopped at line \$1" >&2; \}/);
    for (const script of [seed, dataApi, engine]) {
      expect(script).toMatch(/^set -Eeuo pipefail$/m);
      expect(script).toContain("trap 'on_error $LINENO' ERR");
    }
  });

  it('never test railway\'s output with `| grep -q`: grep closes the pipe, railway dies with SIGPIPE, and under pipefail the guard read "nothing there" and carried on', () => {
    for (const [name, script] of Object.entries(scripts)) {
      for (const line of script.split('\n').filter((l) => !l.trim().startsWith('#'))) {
        expect(line, name).not.toMatch(/railway[^|\n]*\|\s*(grep\s+-\w*q|awk|head)/);   // an early-exiting reader breaks the pipe
        expect(line, name).not.toMatch(/printf '%s\\n' "\$\w+" \| grep -\w*q/);          // and so does a large writer: search with a here-string
      }
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

  it('never put a secret in a --variables argument: keys, tokens, passwords and secrets go through stdin (set_secret)', () => {
    for (const [name, script] of Object.entries(scripts)) {
      for (const line of script.split('\n').filter((l) => !l.trim().startsWith('#'))) expect(line, name).not.toMatch(/--variables\s+"?\w*(KEY|SECRET|PASSWORD|TOKEN|PW)\w*=/);
    }
    expect(common).toMatch(/railway variable set "\$3" --stdin/);
    expect(dataApi).toMatch(/printf '.*:%s@.*' "\$password" \| set_secret postgrest "\$environment" PGRST_DB_URI/);
    expect(engine).toMatch(/env_value "\$envfile" "\$key_name" \| set_secret/);
  });

  it('read the env file in-process and never print a value: no trace mode, and no echo of a value read from it', () => {
    for (const [name, script] of Object.entries(scripts)) {
      expect(script, name).not.toMatch(/set -\w*x|bash -x/);
      expect(script, name).not.toMatch(/echo[^\n]*\$\(env_value/);
    }
  });

  it('keep the database and the engines off the public internet: no TCP proxy, no public URL, no domain', () => {
    for (const script of Object.values(scripts)) {
      expect(script).not.toMatch(/railway domain/);
      expect(script).not.toMatch(/tcp-proxy\s+(create|add|new)/);
      expect(script).not.toContain('DATABASE_PUBLIC_URL');
    }
    expect(seed).toContain('${{postgres.DATABASE_URL}}');
  });
});

describe('the data API and the engines are deployed from the repo\'s own definitions', () => {
  const compose = read('docker-compose.prod.yml');

  it('PostgREST is the image pinned in docker-compose.prod.yml, read from it so there is one pin, with the compose service\'s settings', () => {
    expect(dataApi).toContain("grep -m1 -o 'postgrest/postgrest@sha256:[0-9a-f]\\{64\\}' \"$REPO/docker-compose.prod.yml\"");
    expect(compose).toMatch(/postgrest\/postgrest@sha256:[0-9a-f]{64}/);
    for (const setting of ['PGRST_DB_SCHEMAS=public', 'PGRST_DB_EXTRA_SEARCH_PATH=public, extensions', 'PGRST_DB_ANON_ROLE=anon', 'PGRST_DB_POOL=10', 'PGRST_DB_PREPARED_STATEMENTS=false']) {
      expect(dataApi).toContain(`--variables "${setting}"`);
      const [key, value] = setting.split('=');
      expect(compose).toMatch(new RegExp(`${key}: (\\$\\{${key}:-${value}\\}|${value})`));
    }
  });

  it('the authenticator password is set by a private one-off job on the same pinned image, as a psql variable (never spliced into the statement), then the job is deleted', () => {
    const job = read('deploy/railway/roles/Dockerfile');
    expect(job).toContain(`FROM ${/postgres:17-alpine@sha256:[0-9a-f]{64}/.exec(read('backend/scripts/baseline-load.sh'))?.[0]}`);
    expect(read('deploy/railway/roles/set-authenticator-password.sh')).toContain("ALTER ROLE authenticator WITH LOGIN PASSWORD :'pw';");
    expect(JSON.parse(read('deploy/railway/roles/railway.json'))).toEqual({ deploy: { restartPolicyType: 'NEVER' } });
    expect(dataApi).toContain('railway service delete --service');
  });

  it('PostgREST uses the DB_JWT_SECRET the backend uses (compose passes it to both) and connects as authenticator over the private address with TLS', () => {
    expect(compose).toMatch(/PGRST_JWT_SECRET: \$\{DB_JWT_SECRET/);
    expect(dataApi).toContain('PGRST_JWT_SECRET');
    expect(dataApi).toContain('postgres://authenticator:%s@${{postgres.RAILWAY_PRIVATE_DOMAIN}}:5432/emithran?sslmode=require');
  });

  it('each engine gets the compose service\'s port and settings, and the API key the backend sends', () => {
    expect(compose).toMatch(/PORT: 5055/);
    expect(compose).toMatch(/PORT: 5100/);
    for (const v of ['PORT=5055', 'MAX_CONCURRENT_ANALYSES=1', 'ANALYSIS_HARD_LIMIT_SECONDS=900', 'RATE_LIMIT_PER_MINUTE=10', 'PORT=5100']) expect(engine).toContain(`"${v}"`);
    expect(engine).toContain('CAD_ENGINE_API_KEY');
    expect(engine).toContain('ECAD_ENGINE_API_KEY');
  });

  it('refuse to run twice, refuse a missing value by name, and remove a service that failed to start', () => {
    expect(dataApi).toMatch(/already has a postgrest service/);
    expect(engine).toMatch(/already has a \$engine service/);
    expect(engine).toContain('require_env_values "$envfile" "${required[@]}"');
    expect(engine).toContain('removing the failed $created service');
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
