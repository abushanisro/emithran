/**
 * Fails when frontend code imports a database client, a storage SDK, or the Supabase wrapper outside the allow-list.
 * The browser must reach data only through the API (PRD 13, Design 18.1). Files that still do are listed in
 * frontend-boundary-allowlist.json with the PR that removes them; the list can only shrink.
 *   npm run check:boundary
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import ts from 'typescript';

const SCANNED_ROOTS = ['app', 'lib', 'components', 'hooks', 'types', 'proxy.ts'];
const SOURCE_EXTENSIONS = new Set(['.ts', '.tsx', '.mts', '.cts', '.js', '.jsx', '.mjs', '.cjs']);

const FORBIDDEN_SCOPES = new Set(['@supabase', '@aws-sdk']);
const FORBIDDEN_PACKAGES = new Set([
  'pg', 'pg-pool', 'pg-cursor', 'pg-query-stream', 'postgres', 'kysely', 'knex', 'mysql2', 'typeorm', 'drizzle-orm', '@prisma/client',
]);
const SUPABASE_WRAPPER = 'lib/supabase';

export interface ImportViolation {
  file: string;
  line: number;
  specifier: string;
}

export type Allowlist = Readonly<Record<string, string>>;

function packageName(specifier: string): string {
  const parts = specifier.split('/');
  return specifier.startsWith('@') ? parts.slice(0, 2).join('/') : (parts[0] ?? specifier);
}

/** Repo-relative target of an aliased or relative specifier; null for packages. */
function localTarget(file: string, specifier: string): string | null {
  if (specifier.startsWith('@/')) return path.posix.normalize(specifier.slice(2));
  if (specifier.startsWith('.')) return path.posix.normalize(path.posix.join(path.posix.dirname(file), specifier));
  return null;
}

function isForbidden(file: string, specifier: string): boolean {
  const target = localTarget(file, specifier);
  if (target !== null) return target === SUPABASE_WRAPPER || target.startsWith(`${SUPABASE_WRAPPER}/`);
  const name = packageName(specifier);
  return FORBIDDEN_PACKAGES.has(name) || FORBIDDEN_SCOPES.has(name.split('/')[0] ?? '');
}

/**
 * Every forbidden import in one file. TypeScript's own pre-processor finds static, type-only, re-exported, dynamic and
 * require() imports and skips comments and strings, which a regex cannot do reliably.
 */
export function findForbiddenImports(file: string, source: string): ImportViolation[] {
  const { importedFiles } = ts.preProcessFile(source, true, true);
  return importedFiles
    .filter(({ fileName }) => isForbidden(file, fileName))
    .map(({ fileName, pos }) => ({ file, line: source.slice(0, pos).split('\n').length, specifier: fileName }));
}

export function compareToAllowlist(
  violations: readonly ImportViolation[],
  allowlist: Allowlist,
): { unlisted: ImportViolation[]; stale: string[] } {
  const offending = new Set(violations.map((v) => v.file));
  return {
    unlisted: violations.filter((v) => !Object.hasOwn(allowlist, v.file)),
    stale: Object.keys(allowlist).filter((file) => !offending.has(file)),
  };
}

export function parseAllowlist(text: string): Allowlist {
  const parsed: unknown = JSON.parse(text);
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new Error('allow-list must be a JSON object of "file": "reason"');
  }
  return Object.fromEntries(
    Object.entries(parsed).map(([file, reason]: [string, unknown]) => {
      if (typeof reason !== 'string' || reason.trim() === '') throw new Error(`allow-list entry ${file} needs a reason`);
      return [file, reason];
    }),
  );
}

/** Source files under the scanned roots, as sorted repo-relative POSIX paths. */
export function listSourceFiles(repoRoot: string): string[] {
  const files: string[] = [];
  const visit = (rel: string): void => {
    const entries = readdirSync(path.join(repoRoot, rel), { withFileTypes: true });
    for (const entry of entries) {
      const child = path.posix.join(rel, entry.name);
      if (entry.isDirectory()) {
        if (entry.name !== 'node_modules' && !entry.name.startsWith('.')) visit(child);
      } else if (SOURCE_EXTENSIONS.has(path.extname(entry.name))) {
        files.push(child);
      }
    }
  };
  for (const root of SCANNED_ROOTS) {
    const full = path.join(repoRoot, root);
    if (!existsSync(full)) continue;
    if (statSync(full).isDirectory()) visit(root);
    else files.push(root);
  }
  return files.sort();
}

function main(): number {
  const repoRoot = path.resolve(import.meta.dirname, '..');
  const allowlist = parseAllowlist(readFileSync(path.join(import.meta.dirname, 'frontend-boundary-allowlist.json'), 'utf8'));
  const violations = listSourceFiles(repoRoot).flatMap((file) =>
    findForbiddenImports(file, readFileSync(path.join(repoRoot, file), 'utf8')),
  );
  const { unlisted, stale } = compareToAllowlist(violations, allowlist);

  for (const v of unlisted) {
    console.error(`error  ${v.file}:${v.line}  imports '${v.specifier}'; call the API through lib/api instead`);
  }
  for (const file of stale) {
    console.error(`error  ${file}  no longer imports a forbidden module; remove it from scripts/frontend-boundary-allowlist.json`);
  }
  const errors = unlisted.length + stale.length;
  const remaining = Object.keys(allowlist).length - stale.length;
  console.log(`Frontend boundary check: ${errors} error(s); ${remaining} allow-listed file(s) still to move behind the API.`);
  return errors === 0 ? 0 : 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = main();
}
