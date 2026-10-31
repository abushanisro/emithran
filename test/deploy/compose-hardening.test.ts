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
  it.each(services)('%s is locked down: read-only, no capabilities, no privilege escalation, limits, logs, restart', (_name, s) => {
    expect(s.read_only).toBe(true);
    expect(s.cap_drop).toContain('ALL');
    expect(s.cap_add).toBeUndefined();
    expect(s.security_opt).toContain('no-new-privileges:true');
    expect(s.privileged).toBeUndefined();
    expect(s.network_mode).toBeUndefined();
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
    expect(runtime.filter((n) => /SECRET|SERVICE_KEY|DATABASE_URL|PASSWORD|TOKEN/i.test(n)).sort()).toEqual(['AUTH0_CLIENT_SECRET', 'AUTH0_SECRET']);
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
  });

  it('hands the browser bundle the real API address, not the localhost default it would otherwise compile in', () => {
    const args = compose.services.frontend?.build?.args ?? {};
    expect(String(args.NEXT_PUBLIC_API_URL)).toBe('${NEXT_PUBLIC_API_GATEWAY_URL}/v1/api');
    expect(read('Dockerfile.frontend')).toMatch(/ARG NEXT_PUBLIC_API_URL\b/);
    expect(String(compose.services.frontend?.environment?.API_URL)).toBe('http://backend:4000/v1/api'); // server-side, private
  });

  it('feeds one upload limit to the browser, the backend and the engine', () => {
    const text = read('docker-compose.prod.yml');
    expect(text).toMatch(/NEXT_PUBLIC_MAX_UPLOAD_MB: \$\{MAX_UPLOAD_MB:-50\}/);
    expect(text).toMatch(/\n\s+MAX_UPLOAD_MB: \$\{MAX_UPLOAD_MB:-50\}/);
    expect(text).toMatch(/MAX_FILE_SIZE_MB: \$\{MAX_UPLOAD_MB:-50\}/);
    expect(read('Dockerfile.frontend')).toMatch(/ARG NEXT_PUBLIC_MAX_UPLOAD_MB\b/);
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
