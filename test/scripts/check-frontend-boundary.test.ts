import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  compareToAllowlist,
  findForbiddenImports,
  listSourceFiles,
  parseAllowlist,
} from '../../scripts/check-frontend-boundary';

const specifiers = (file: string, source: string) => findForbiddenImports(file, source).map((v) => v.specifier);

describe('findForbiddenImports', () => {
  it('finds static, type-only, re-export, dynamic and require imports of database clients', () => {
    const source = [
      "import { createBrowserClient } from '@supabase/ssr';",
      "import type { User } from '@supabase/supabase-js';",
      "export { Pool } from 'pg';",
      "const k = await import('kysely');",
      "const p = require('postgres');",
      "import '@aws-sdk/client-s3';",
    ].join('\n');

    expect(specifiers('lib/x.ts', source)).toEqual([
      '@supabase/ssr',
      '@supabase/supabase-js',
      'pg',
      'kysely',
      'postgres',
      '@aws-sdk/client-s3',
    ]);
  });

  it('reports the line of each import', () => {
    const source = "const a = 1;\n\nimport { Pool } from 'pg';\n";
    expect(findForbiddenImports('lib/x.ts', source)).toEqual([{ file: 'lib/x.ts', line: 3, specifier: 'pg' }]);
  });

  it('finds the Supabase wrapper through the @ alias and through relative paths', () => {
    expect(specifiers('app/page.tsx', "import { supabase } from '@/lib/supabase/client';")).toEqual([
      '@/lib/supabase/client',
    ]);
    // The case a plain regex over "lib/supabase" misses: lib/api/hooks/useProcessPlanGenerate.ts
    expect(specifiers('lib/api/hooks/useX.ts', "import { supabase } from '../../supabase/client';")).toEqual([
      '../../supabase/client',
    ]);
  });

  it('ignores imports in comments and strings', () => {
    const source = "// import { Pool } from 'pg';\nconst s = \"import x from '@supabase/ssr'\";\n";
    expect(findForbiddenImports('lib/x.ts', source)).toEqual([]);
  });

  it('allows packages that only share a prefix with a forbidden one', () => {
    const source = "import a from 'pgp-utils';\nimport b from '@supabase-like/x';\nimport c from '@/lib/supabase-docs';";
    expect(findForbiddenImports('lib/x.ts', source)).toEqual([]);
  });
});

describe('compareToAllowlist', () => {
  const violation = (file: string) => ({ file, line: 1, specifier: 'pg' });

  it('reports files that import a forbidden module and are not listed', () => {
    const result = compareToAllowlist([violation('lib/listed.ts'), violation('lib/new.ts')], {
      'lib/listed.ts': 'reason',
    });
    expect(result.unlisted.map((v) => v.file)).toEqual(['lib/new.ts']);
    expect(result.stale).toEqual([]);
  });

  it('reports listed files that no longer import one, so the list can only shrink', () => {
    const result = compareToAllowlist([], { 'lib/cleaned.ts': 'reason' });
    expect(result.stale).toEqual(['lib/cleaned.ts']);
  });
});

describe('parseAllowlist', () => {
  it('accepts an object of file paths to reasons', () => {
    expect(parseAllowlist('{"lib/a.ts": "browser client until P1-01"}')).toEqual({
      'lib/a.ts': 'browser client until P1-01',
    });
  });

  it.each([['[]'], ['{"lib/a.ts": ""}'], ['{"lib/a.ts": 1}'], ['not json']])('rejects %s', (text) => {
    expect(() => parseAllowlist(text)).toThrow();
  });
});

describe('listSourceFiles', () => {
  let root: string | undefined;
  afterEach(() => {
    if (root) rmSync(root, { recursive: true, force: true });
  });

  it('lists source files under the scanned roots only, as repo-relative paths', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'boundary-'));
    root = dir;
    const write = (rel: string) => {
      mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
      writeFileSync(path.join(dir, rel), '');
    };
    ['app/page.tsx', 'lib/a/b.ts', 'components/c.jsx', 'proxy.ts', 'lib/node_modules/x/index.js', 'lib/readme.md', 'backend/src/x.ts'].forEach(write);

    expect(listSourceFiles(dir)).toEqual(['app/page.tsx', 'components/c.jsx', 'lib/a/b.ts', 'proxy.ts']);
  });
});
