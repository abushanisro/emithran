import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { scanSource, scanRepoJwt } = require('../../../scripts/rls-bypass-rules');

const rulesFor = (path: string, text: string) =>
  scanSource(path, text).filter((v: any) => v.severity === 'error').map((v: any) => v.rule);

describe('RLS boundary CI rules', () => {
  it('keeps raw-material editor privileged access compliant with the literal-reason boundary', () => {
    const sourcePath = 'src/modules/raw-materials/services/raw-material-editor.service.ts';
    const text = readFileSync(resolve(__dirname, '../../..', sourcePath), 'utf8');
    expect(rulesFor(sourcePath, text)).toEqual([]);
  });
  const svc = 'src/modules/x/x.service.ts';

  it.each([
    ['dot-client', 'const c = this.supabaseService.client.from("t");'],
    ['dot-client', 'await this.supabase.client\n  .from("t")'],
    ['get-admin-client', 'const c = this.supabase.getAdminClient();'],
    ['getclient-no-token', 'const c = this.supabase.getClient();'],
    ['getclient-optional-token', 'const c = this.supabase.getClient(accessToken ?? undefined);'],
    ['second-db-path', "import { Pool } from 'pg';"],
    ['second-db-path', "import knex from 'knex';"],
    ['second-db-path', "import { TypeOrmModule } from '@nestjs/typeorm';"],
    ['own-supabase-client', "const c = createClient(url, key);"],
    ['service-key-outside-boundary', "const k = process.env.SUPABASE_SERVICE_KEY;"],
    // Assembled at runtime so no JWT literal exists in source, even a synthetic one.
    ['hardcoded-jwt', `const k = '${['eyJhbGciOiJIUzI1NiJ9', 'eyJyb2xlIjoieCIsInJlZiI6InRlc3QifQ', 'abcdefghij1234'].join('.')}';`],
    ['privileged-reason', 'const c = this.supabase.getPrivilegedClient(reason);'],
    ['privileged-reason', 'const c = this.supabase.getPrivilegedClient(`x ${y}`);'],
    ['privileged-reason', "const c = this.supabase.getPrivilegedClient('x');"],
    ['privileged-reason', 'const c = this.supabase.getPrivilegedClient();'],
  ])('flags %s', (rule, code) => {
    expect(rulesFor(svc, code)).toContain(rule);
  });

  it.each([
    'const c = this.supabase.getUserClient();',
    'const c = this.supabase.getUserClient(accessToken);',
    'const c = this.supabase.getClient(accessToken);',
    "const c = this.supabase.getPrivilegedClient('reference-data: sm_reference_data, global shared');",
    "const c = this.supabase\n  .getPrivilegedClient(\"system-job: should-cost calibration updates global rates\");",
    'const client = this.httpClient.client;',
  ])('accepts compliant code: %s', (code) => {
    expect(rulesFor(svc, code)).toEqual([]);
  });

  it('allows SupabaseService itself to define and use the privileged primitives', () => {
    const text = [
      "import { createClient } from '@supabase/supabase-js';",
      "this.url = config.get('SUPABASE_SERVICE_KEY');",
      'this.adminClient = createClient(a, b);',
    ].join('\n');
    expect(rulesFor('src/common/supabase/supabase.service.ts', text)).toEqual([]);
  });

  it('allows the service key in env validation config only', () => {
    expect(rulesFor('src/config/env.validation.ts', 'SUPABASE_SERVICE_KEY: string;')).toEqual([]);
    expect(rulesFor('src/modules/y/y.service.ts', 'SUPABASE_SERVICE_KEY: string;')).toContain('service-key-outside-boundary');
  });

  it("allows 'pg' only in the LISTEN/NOTIFY event bus, and nothing else there", () => {
    const bus = 'src/common/events/postgres-event-bus.ts';
    expect(rulesFor(bus, "import { Client } from 'pg';")).toEqual([]);
    expect(rulesFor(bus, "import knex from 'knex';")).toContain('second-db-path');
    expect(rulesFor('src/common/events/event-bus.ts', "import { Client } from 'pg';")).toContain('second-db-path');
    const real = readFileSync(resolve(__dirname, '../../..', bus), 'utf8');
    expect(rulesFor(bus, real)).toEqual([]);
  });

  it('treats a reintroduced getAdminClient() as an error everywhere, with no allowlist', () => {
    for (const file of ['src/app.controller.ts', 'src/modules/z/z.service.ts']) {
      expect(rulesFor(file, 'x.getAdminClient()')).toContain('get-admin-client');
    }
  });

  it('reports the 1-based line of each violation', () => {
    const r = scanSource(svc, 'a\nb\nconst c = this.supabase.getClient();');
    expect(r[0].line).toBe(3);
  });

  describe('repo-wide JWT literal scan', () => {
    // Built at runtime: no JWT literal exists in this file.
    const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString('base64url');
    const jwt = (role: string) => `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ role, ref: 'test-ref' })}.signature1234567`;

    it('fails on a service_role JWT in any file type (compose, docs, frontend, tests)', () => {
      for (const file of ['docker-compose.prod.yml', 'docs/setup.md', 'src/lib/x.ts', 'backend/src/test/y.spec.ts']) {
        const r = scanRepoJwt(file, `KEY: ${jwt('service_role')}`);
        expect(r).toEqual([expect.objectContaining({ rule: 'service-role-jwt-literal', severity: 'error', line: 1 })]);
      }
    });

    it('only warns on a non-service-role JWT such as a public anon key', () => {
      expect(scanRepoJwt('a.yml', `K: ${jwt('anon')}`)).toEqual([
        expect.objectContaining({ rule: 'jwt-literal', severity: 'warning' }),
      ]);
    });

    it('ignores text that is not a JWT', () => {
      expect(scanRepoJwt('a.md', 'SUPABASE_SERVICE_KEY=${SUPABASE_SERVICE_KEY:?set it}')).toEqual([]);
    });
  });
});
