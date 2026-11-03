import fs from 'node:fs';
import path from 'node:path';

import yaml from 'js-yaml';
import { describe, expect, it } from 'vitest';

// Policy as code for the stage and production deployment (docs/DEPLOYMENT_SECURITY.md). Each rule below is a decision that
// is easy to undo by accident in a later edit; a failing test here is the reminder of why it was made.
const read = (file: string) => fs.readFileSync(path.resolve(process.cwd(), file), 'utf8');

interface Service {
  image?: string;
  build?: { context: string; dockerfile: string; args?: Record<string, string> };
  read_only?: boolean;
  cap_drop?: string[];
  cap_add?: string[];
  security_opt?: string[];
  privileged?: boolean;
  network_mode?: string;
  user?: string;
  group_add?: string[];
  pid_limit?: number;
  pids_limit?: number;
  ports?: unknown[];
  volumes?: string[];
  networks?: string[];
  environment?: Record<string, string | number>;
  restart?: string;
  healthcheck?: unknown;
  deploy?: { resources?: { limits?: { memory?: string; cpus?: string; pids?: number } } };
  logging?: { options?: Record<string, string> };
}
interface Compose {
  services: Record<string, Service>;
  networks: Record<string, { internal?: boolean } | null>;
}

const compose = yaml.load(read('docker-compose.prod.yml')) as Compose;
const services = Object.entries(compose.services);

describe('docker-compose.prod.yml', () => {
  it.each(services)('%s is locked down: read-only, no capabilities, no privilege escalation, limits, logs, restart', (name, s) => {
    expect(s.read_only).toBe(true);
    expect(s.cap_drop).toContain('ALL');
    expect(s.cap_add).toBeUndefined();
    expect(s.security_opt).toContain('no-new-privileges:true');
    expect(s.privileged).toBeUndefined();
    // Sharing another container's or the host's network namespace is never allowed; only the CAD worker has none at all.
    expect(s.network_mode).toBe(name === 'cad-worker' ? 'none' : undefined);
    expect(s.deploy?.resources?.limits?.pids).toBeGreaterThan(0);
    expect(s.deploy?.resources?.limits?.memory).toBeTruthy();
    expect(s.deploy?.resources?.limits?.cpus).toBeTruthy();
    expect(s.logging?.options?.['max-size']).toBeTruthy();
    expect(s.restart).toBe('unless-stopped');
    expect(s.healthcheck).toBeTruthy();
  });

  it('no Dockerfile writes an env file into its image: settings come from the environment, never from a baked file', () => {
    for (const dockerfile of ['backend/Dockerfile', 'Dockerfile.frontend', 'cad-engine/Dockerfile', 'ecad-engine/Dockerfile', 'core/Dockerfile']) {
      const text = read(dockerfile);
      expect(text, dockerfile).not.toMatch(/>>?\s*\.env\b/);
      expect(text, dockerfile).not.toMatch(/COPY[^\n]*\.env(\s|$)/);
    }
  });

  it('publishes no host port: the Cloudflare tunnel is the only way in', () => {
    for (const [, s] of services) expect(s.ports).toBeUndefined();
  });

  it('never mounts the Docker socket or a host path', () => {
    for (const [, s] of services) {
      for (const volume of s.volumes ?? []) {
        expect(volume).not.toContain('docker.sock');
        expect(volume.startsWith('/') || volume.startsWith('.')).toBe(false); // named volumes only
      }
    }
  });

  it('pins every third-party image by digest, so a rebuild cannot silently pull different bytes', () => {
    for (const [, s] of services) if (s.image) expect(s.image).toMatch(/@sha256:[0-9a-f]{64}$/);
  });

  it('keeps the engines off the internet and off the edge network', () => {
    expect(compose.networks.internal?.internal).toBe(true);
    for (const name of ['cad-engine', 'ecad-engine']) expect(compose.services[name]?.networks).toEqual(['internal']);
    expect(compose.services.cloudflared?.networks).toEqual(['edge']);
  });

  it("gives the frontend only the Auth0 server secrets it needs as the BFF, never a database credential, never in the browser bundle", () => {
    const frontend = compose.services.frontend;
    const runtime = Object.keys(frontend?.environment ?? {});
    const buildArgs = Object.keys(frontend?.build?.args ?? {});
    // The Next.js server is the confidential Auth0 client: its client secret and session secret are runtime settings on the server.
    // BFF_FORWARD_SECRET signs the client address it forwards to the API (lib/server/bff/forward.ts).
    expect(runtime.filter((n) => /SECRET|SERVICE_KEY|DATABASE_URL|PASSWORD|TOKEN/i.test(n)).sort()).toEqual(['AUTH0_CLIENT_SECRET', 'AUTH0_SECRET', 'BFF_FORWARD_SECRET']);
    expect(buildArgs.filter((n) => /SECRET|SERVICE_KEY|DATABASE_URL|PASSWORD|TOKEN/i.test(n))).toEqual([]);
    for (const arg of buildArgs) expect(arg.startsWith('NEXT_PUBLIC_')).toBe(true);
  });

  it('keeps the frontend off the database network: only the backend reaches PostgREST', () => {
    const networksOf = (name: string) => {
      const networks = compose.services[name]?.networks ?? [];
      return Array.isArray(networks) ? networks : Object.keys(networks);
    };
    expect(networksOf('frontend')).not.toContain('db');
    expect(networksOf('backend')).toContain('db');
    expect(networksOf('postgrest')).toEqual(['db']);
    // Everything on `db` is named here, so adding a peer is a deliberate change (cad-core holds DB_JWT_SECRET itself).
    expect(services.filter(([n]) => networksOf(n).includes('db')).map(([n]) => n).sort()).toEqual(['backend', 'cad-core', 'postgrest']);
  });

  it("keeps PostgREST's admin server on loopback: no db-network peer can reach it, its healthcheck runs inside the container", () => {
    const postgrest = compose.services.postgrest;
    expect(postgrest?.environment?.PGRST_ADMIN_SERVER_HOST).toBe('127.0.0.1');
    expect(postgrest?.healthcheck).toEqual(expect.objectContaining({ test: ['CMD', 'postgrest', '--ready'] }));
  });

  it('serves the cloudflared metrics on loopback only, not to the other services on edge', () => {
    const cloudflared = compose.services.cloudflared as Service & { command?: string };
    expect(cloudflared.command).toMatch(/--metrics 127\.0\.0\.1:2000\b/);
    expect(cloudflared.command).not.toMatch(/0\.0\.0\.0/);
  });

  it('parses customer CAD only in cad-worker: no credential, no network, its own user, only the socket volume shared', () => {
    const worker = compose.services['cad-worker'];
    const runner = compose.services['cad-core'];
    expect(worker?.network_mode).toBe('none');
    expect(worker?.networks).toBeUndefined();
    // Limits only: anything else in its environment needs a deliberate change here.
    expect(Object.keys(worker?.environment ?? {}).sort()).toEqual(['MAX_UPLOAD_MB', 'WORKER_MEMORY_MB']);
    expect(/^ {2}cad-worker:\n(?: {4}.*\n|\n)*/m.exec(read('docker-compose.prod.yml'))?.[0]).not.toMatch(/SECRET|KEY|TOKEN|PASSWORD|URL|DB_URI/);
    expect(worker?.user).toBeTruthy();
    expect(runner?.user).toBeTruthy();
    expect(worker?.user?.split(':')[0]).not.toBe(runner?.user?.split(':')[0]);
    expect(worker?.read_only).toBe(true);
    expect(worker?.cap_drop).toContain('ALL');
    // The worker's volume is the socket's only, and only the runner shares it.
    expect(worker?.volumes).toEqual(['cad-worker-socket:/run/cad-worker']);
    const sharing = services.filter(([, s]) => (s.volumes ?? []).some((v) => v.startsWith('cad-worker-socket:'))).map(([n]) => n).sort();
    expect(sharing).toEqual(['cad-core', 'cad-worker']);
    expect(runner?.group_add).toEqual([worker?.user?.split(':')[1]]);
  });

  it('cad-core refuses to start without its database secret and bucket settings', () => {
    const env = compose.services['cad-core']?.environment ?? {};
    for (const name of ['DB_JWT_SECRET', 'S3_BUCKET', 'S3_REGION', 'S3_ACCESS_KEY_ID', 'S3_SECRET_ACCESS_KEY']) {
      expect(String(env[name]), name).toMatch(new RegExp(`^\\$\\{${name}:\\?`));
    }
  });

  it('hands the browser bundle the real API address, not the localhost default it would otherwise compile in', () => {
    const args = compose.services.frontend?.build?.args ?? {};
    expect(String(args.NEXT_PUBLIC_API_URL)).toBe('${NEXT_PUBLIC_API_GATEWAY_URL}/api/v1');
    expect(read('Dockerfile.frontend')).toMatch(/ARG NEXT_PUBLIC_API_URL\b/);
    expect(String(compose.services.frontend?.environment?.API_URL)).toBe('http://backend:4000/api/v1'); // server-side, private
  });

  it('feeds one upload limit to the browser, the backend and the engine', () => {
    const text = read('docker-compose.prod.yml');
    expect(text).toMatch(/NEXT_PUBLIC_MAX_UPLOAD_MB: \$\{MAX_UPLOAD_MB:-50\}/);
    expect(text).toMatch(/\n\s+MAX_UPLOAD_MB: \$\{MAX_UPLOAD_MB:-50\}/);
    expect(text).toMatch(/MAX_FILE_SIZE_MB: \$\{MAX_UPLOAD_MB:-50\}/);
    expect(read('Dockerfile.frontend')).toMatch(/ARG NEXT_PUBLIC_MAX_UPLOAD_MB\b/);
  });

  it('caps the backend V8 heap at about 70% of its container memory, so V8 fails before the kernel kills the container', () => {
    const backend = compose.services.backend;
    const heapMb = Number(/--max-old-space-size=(\d+)/.exec(String(backend?.environment?.NODE_OPTIONS))?.[1]);
    const limit = /^(\d+)([MG])$/.exec(String(backend?.deploy?.resources?.limits?.memory));
    const limitMb = limit ? Number(limit[1]) * (limit[2] === 'G' ? 1024 : 1) : NaN;
    expect(heapMb / limitMb).toBeGreaterThanOrEqual(0.6);
    expect(heapMb / limitMb).toBeLessThanOrEqual(0.75);
  });

  it('gives the BFF and the backend the same required secret for the forwarded client address, and trusts no proxy hop', () => {
    for (const service of ['frontend', 'backend']) {
      expect(String(compose.services[service]?.environment?.BFF_FORWARD_SECRET)).toMatch(/^\$\{BFF_FORWARD_SECRET:\?/);
    }
    expect(String(compose.services.backend?.environment?.TRUST_PROXY)).toBe('0');
  });

  it('keeps the runner off the edge network: it could forge the Cloudflare client-address header to the backend from there', () => {
    expect(compose.services['cad-core']?.networks).toEqual(['db']);
    expect(compose.services['cad-worker']?.networks).toBeUndefined();
    const edgePeers = services.filter(([, s]) => (s.networks ?? []).includes('edge')).map(([n]) => n).sort();
    expect(edgePeers).toEqual(['backend', 'cloudflared', 'frontend']);
  });

  it('passes every AI, authorization and limit setting through to the backend, each documented in both env templates', () => {
    const backendEnv = compose.services.backend?.environment ?? {};
    const settings = [
      'ANTHROPIC_API_KEY', 'AI_DISABLED', 'AI_USER_DAILY_TOKENS', 'AI_ORG_DAILY_TOKENS', 'AI_GLOBAL_DAILY_TOKENS', 'AI_MAX_CONCURRENT_PER_USER',
      'FX_RATE_MAX_CHANGE_PERCENT', 'AUTH_DECISION_CACHE_SECONDS', 'ORG_THROTTLE_LIMIT', 'ORG_THROTTLE_TTL',
      'ARCHIVE_MAX_EXPANDED_MB', 'HEAVY_WORK_MAX_CONCURRENT', 'HEAVY_WORK_MAX_PER_TENANT',
    ];
    for (const name of settings) {
      expect(String(backendEnv[name]), name).toMatch(new RegExp(`^\\$\\{${name}:-`));
      for (const template of ['env/stage.env.example', 'env/prd.env.example', '.env.example']) {
        expect(read(template), `${template} ${name}`).toMatch(new RegExp(`^#? ?${name}=`, 'm'));
      }
    }
    // Required: sign-in cannot link a new login without the trusted connections.
    expect(String(backendEnv.AUTH0_TRUSTED_CONNECTIONS)).toMatch(/^\$\{AUTH0_TRUSTED_CONNECTIONS:\?/);
  });

  it('contains no secret value, only references to the env file', () => {
    const text = read('docker-compose.prod.yml');
    expect(text).not.toMatch(/sb_secret_|eyJ[A-Za-z0-9_-]{20,}|sk-ant-|AIza[0-9A-Za-z_-]{20,}/);
    expect(text).not.toMatch(/supabase\.co/); // the project comes from SUPABASE_URL, never a literal
  });

  it('is fully described by the env templates: every required variable exists in both', () => {
    const required = [...new Set([...read('docker-compose.prod.yml').matchAll(/\$\{([A-Z0-9_]+):\?/g)].map((m) => m[1]))];
    for (const template of ['env/stage.env.example', 'env/prd.env.example']) {
      const defined = new Set(read(template).split('\n').filter((l) => /^[A-Z]/.test(l)).map((l) => l.split('=')[0]));
      expect(required.filter((v) => !defined.has(v!)), template).toEqual([]);
    }
  });
});

describe('Dockerfiles', () => {
  const files = ['backend/Dockerfile', 'Dockerfile.frontend', 'cad-engine/Dockerfile', 'ecad-engine/Dockerfile'];

  it.each(files)('%s: pinned base by digest, non-root, no env files copied in', (file) => {
    const text = read(file);
    const froms = [...text.matchAll(/^FROM\s+(\S+)(?:\s+AS\s+\S+)?/gm)].map((m) => m[1] as string);
    // Stage names refer to earlier stages; `scratch` is Docker's reserved empty base (nothing is pulled, so nothing to pin).
    for (const from of froms.filter((f) => !['base', 'deps', 'builder', 'runner', 'build', 'runtime', 'scratch'].includes(f))) {
      expect(from, `${file}: ${from}`).toMatch(/@sha256:[0-9a-f]{64}$/);
    }
    const lastUser = [...text.matchAll(/^USER\s+(\S+)/gm)].pop()?.[1];
    expect(lastUser, `${file} must end as a non-root user`).toBeTruthy();
    expect(['root', '0']).not.toContain(lastUser);
    expect(text).not.toMatch(/COPY[^\n]*\.env/);
  });

  it('supported runtimes only: no Node 20 (end of life since April 2026)', () => {
    for (const file of ['backend/Dockerfile', 'Dockerfile.frontend']) expect(read(file)).not.toMatch(/node:(18|20)/);
  });

  it.each(['.dockerignore', 'backend/.dockerignore', 'cad-engine/.dockerignore'])('%s keeps env files and logs out of the image', (file) => {
    const lines = read(file).split('\n').map((l) => l.trim());
    expect(lines).toContain('.env');
    expect(lines.some((l) => l === '.env.*' || l === '.env.production')).toBe(true);
    expect(lines.filter((l) => l.startsWith('!') && l.includes('.env'))).toEqual([]); // no exceptions that re-include one
    // A bare *.log only matches at the top level, so a logs folder needs its own rule (it can name customer files).
    expect(lines.some((l) => l === 'logs' || l === 'logs/' || l === '**/*.log')).toBe(true);
  });
});

describe('docker-compose.data.yml (self-hosted data tier)', () => {
  const data = yaml.load(read('docker-compose.data.yml')) as Compose;

  it.each(Object.entries(data.services))('%s is locked down and private', (_name, s) => {
    expect(s.read_only).toBe(true);
    expect(s.cap_drop).toContain('ALL');
    expect(s.cap_add).toBeUndefined();
    expect(s.security_opt).toContain('no-new-privileges:true');
    expect(s.privileged).toBeUndefined();
    expect(s.network_mode).toBeUndefined();
    expect(s.user).toMatch(/^\d+:\d+$/);
    expect(s.networks).toEqual(['db']);
    expect(s.deploy?.resources?.limits?.pids).toBeGreaterThan(0);
    expect(s.deploy?.resources?.limits?.memory).toBeTruthy();
    expect(s.healthcheck).toBeTruthy();
  });

  it('publishes nothing to the network: Postgres only on the host loopback, the file store not at all', () => {
    expect(data.services.postgres.ports).toEqual(['127.0.0.1:${PG_PORT:-5432}:5432']);
    expect(data.services.storage.ports).toBeUndefined();
  });

  it('has no password or key in the file: every secret comes from the env file', () => {
    for (const s of Object.values(data.services)) {
      for (const value of Object.values(s.environment ?? {})) expect(String(value)).toMatch(/^\$\{/);
    }
  });
});
