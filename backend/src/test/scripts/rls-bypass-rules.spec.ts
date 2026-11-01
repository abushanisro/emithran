import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { scanSource, scanRepoJwt, countPrivilegedCalls, compareToBaseline, lowerBaseline, parseBaseline } = require('../../../scripts/rls-bypass-rules');

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
    ['dot-client', 'const c = this.databaseService.client.from("t");'],
    ['dot-client', 'await this.database.client\n  .from("t")'],
    ['get-admin-client', 'const c = this.database.getAdminClient();'],
    ['getclient-no-token', 'const c = this.database.getClient();'],
    ['getclient-optional-token', 'const c = this.database.getClient(accessToken ?? undefined);'],
    ['second-db-path', "import { Pool } from 'pg';"],
    ['second-db-path', "import knex from 'knex';"],
    ['second-db-path', "import { TypeOrmModule } from '@nestjs/typeorm';"],
    ['own-database-client', "const c = createClient(url, key);"],
    ['service-key-outside-boundary', "const k = process.env.SUPABASE_SERVICE_KEY;"],
    // Assembled at runtime so no JWT literal exists in source, even a synthetic one.
    ['hardcoded-jwt', `const k = '${['eyJhbGciOiJIUzI1NiJ9', 'eyJyb2xlIjoieCIsInJlZiI6InRlc3QifQ', 'abcdefghij1234'].join('.')}';`],
    ['privileged-reason', 'const c = this.database.getPrivilegedClient(reason);'],
    ['privileged-reason', 'const c = this.database.getPrivilegedClient(`x ${y}`);'],
    ['privileged-reason', "const c = this.database.getPrivilegedClient('x');"],
    ['privileged-reason', 'const c = this.database.getPrivilegedClient();'],
  ])('flags %s', (rule, code) => {
    expect(rulesFor(svc, code)).toContain(rule);
  });

  it.each([
    'const c = this.database.getUserClient();',
    'const c = this.database.getUserClient(accessToken);',
    'const c = this.database.getClient(accessToken);',
    "const c = this.database.getPrivilegedClient('reference-data: sm_reference_data, global shared');",
    "const c = this.database\n  .getPrivilegedClient(\"system-job: should-cost calibration updates global rates\");",
    'const client = this.httpClient.client;',
  ])('accepts compliant code: %s', (code) => {
    expect(rulesFor(svc, code)).toEqual([]);
  });

  it('allows DatabaseService itself to define and use the privileged primitives', () => {
    const text = [
      "import { createClient } from '@supabase/supabase-js';",
      "this.url = config.get('SUPABASE_SERVICE_KEY');",
      'this.adminClient = createClient(a, b);',
    ].join('\n');
    expect(rulesFor('src/common/database/database.service.ts', text)).toEqual([]);
  });

  it('allows the service key in env validation config only', () => {
    expect(rulesFor('src/config/env.validation.ts', 'SUPABASE_SERVICE_KEY: string;')).toEqual([]);
    expect(rulesFor('src/modules/y/y.service.ts', 'SUPABASE_SERVICE_KEY: string;')).toContain('service-key-outside-boundary');
  });

  it('allows no database driver in src outside the platform database layer', () => {
    for (const file of ['src/common/events/event-bus.ts', 'src/modules/z/z.service.ts', 'src/platform/tenancy/x.ts']) {
      for (const driver of ['pg', 'kysely', 'knex', 'nestjs-knex', 'typeorm']) expect(rulesFor(file, `import x from '${driver}';`)).toContain('second-db-path');
    }
  });

  it('allows pg and kysely in src/platform/db only, and still no other driver there', () => {
    const file = 'src/platform/db/pools.ts';
    expect(rulesFor(file, "import { Pool } from 'pg';")).toEqual([]);
    expect(rulesFor(file, "import { Kysely } from 'kysely';")).toEqual([]);
    expect(rulesFor(file, "import knex from 'knex';")).toContain('second-db-path');
  });

  it('treats a reintroduced getAdminClient() as an error everywhere, with no allowlist', () => {
    for (const file of ['src/app.controller.ts', 'src/modules/z/z.service.ts']) {
      expect(rulesFor(file, 'x.getAdminClient()')).toContain('get-admin-client');
    }
  });

  it('reports the 1-based line of each violation', () => {
    const r = scanSource(svc, 'a\nb\nconst c = this.database.getClient();');
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

  describe('privileged-call budget', () => {
    it('counts every privileged accessor call in a file', () => {
      const text = "a.getPrivilegedClient('reference-data: x');\nb.getPrivilegedClient (\n  'system-job: y z w');";
      expect(countPrivilegedCalls(text)).toBe(2);
      expect(countPrivilegedCalls('const c = this.database.getUserClient();')).toBe(0);
    });

    it('reports a file above its baseline, including a file with no entry', () => {
      const { increased } = compareToBaseline({ 'src/a.ts': 3, 'src/new.ts': 1 }, { 'src/a.ts': 2 });
      expect(increased).toEqual([
        { file: 'src/a.ts', baseline: 2, now: 3 },
        { file: 'src/new.ts', baseline: 0, now: 1 },
      ]);
    });

    it('reports a file below its baseline, including one with no calls left', () => {
      const { decreased } = compareToBaseline({ 'src/a.ts': 1 }, { 'src/a.ts': 2, 'src/gone.ts': 4 });
      expect(decreased).toEqual([
        { file: 'src/a.ts', baseline: 2, now: 1 },
        { file: 'src/gone.ts', baseline: 4, now: 0 },
      ]);
    });

    it('passes when every file matches its baseline', () => {
      expect(compareToBaseline({ 'src/a.ts': 2 }, { 'src/a.ts': 2 })).toEqual({ increased: [], decreased: [] });
    });

    it('lowers the baseline to current counts but never raises or adds an entry', () => {
      const lowered = lowerBaseline({ 'src/a.ts': 1, 'src/b.ts': 5, 'src/new.ts': 2 }, { 'src/a.ts': 2, 'src/b.ts': 4, 'src/gone.ts': 3 });
      expect(lowered).toEqual({ 'src/a.ts': 1, 'src/b.ts': 4 });
    });

    it('accepts a baseline of file paths to positive integer counts', () => {
      expect(parseBaseline('{"src/a.ts": 2}')).toEqual({ 'src/a.ts': 2 });
    });

    it.each([['[]'], ['{"src/a.ts": 0}'], ['{"src/a.ts": 1.5}'], ['{"src/a.ts": "2"}'], ['not json']])('rejects baseline %s', (text) => {
      expect(() => parseBaseline(text)).toThrow();
    });
  });
});
