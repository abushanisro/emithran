import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

/**
 * ADR-003: browser JavaScript never handles an access token. API calls go same-origin through the BFF, which attaches the token on the
 * server. No exceptions remain; add one only with the PR that removes it.
 */
const ALLOWED: Record<string, string> = {};

/** Ways browser code has fetched or carried a token. */
const TOKEN_PATTERNS = [
  /\.getAccessToken\(/,
  /\.getAuthToken\(/,
  /localStorage\.getItem\(\s*['"](?:token|accessToken)['"]\s*\)/,
  /[?&]token=/,
  /\baccess_token\b/,
];

const ROOTS = ['app', 'components', 'hooks', 'lib'];
// Server-only code may hold the token: that is the point of the BFF. lib/docs holds API documentation text, not code that runs.
const NOT_BROWSER_CODE = [/^app\/api\//, /^lib\/server\//, /^lib\/auth0\.ts$/, /^lib\/supabase\/server\.ts$/, /^lib\/docs\//];

function browserFiles(root: string): string[] {
  const out: string[] = [];
  const visit = (rel: string) => {
    for (const entry of readdirSync(path.join(root, rel), { withFileTypes: true })) {
      const child = path.posix.join(rel, entry.name);
      if (entry.isDirectory()) {
        if (entry.name !== 'node_modules' && !entry.name.startsWith('.')) visit(child);
      } else if (/\.(ts|tsx)$/.test(entry.name) && !NOT_BROWSER_CODE.some((re) => re.test(child))) {
        out.push(child);
      }
    }
  };
  ROOTS.forEach(visit);
  return out.sort();
}

describe('no access token in browser code', () => {
  const repo = path.resolve(import.meta.dirname, '../..');
  const offenders = browserFiles(repo).filter((file) => {
    const source = readFileSync(path.join(repo, file), 'utf8');
    return TOKEN_PATTERNS.some((re) => re.test(source));
  });

  it('only the listed modules touch a token', () => {
    expect(offenders.filter((file) => !(file in ALLOWED))).toEqual([]);
  });

  it('every listed module still does, so the list can only shrink', () => {
    expect(Object.keys(ALLOWED).filter((file) => !offenders.includes(file))).toEqual([]);
  });
});
