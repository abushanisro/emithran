// The web app and the backend agree on paths: every API path the web app calls is a route the backend serves, by its canonical
// name (backend/src/test/common/authz/__snapshots__/route-policies.spec.ts.snap is the list of routes). A rename, a typo or a path
// built for a route that does not exist fails here instead of as a 404 that the client swallows.
//
// Paths that are wrong today are listed in api-paths-unmatched.json: the list can only shrink. After fixing one:
//   UPDATE_API_PATHS=1 npx vitest run test/contract
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

import ts from 'typescript';
import { describe, expect, it } from 'vitest';

const ROOT = process.cwd();
const SNAPSHOT = path.join(ROOT, 'backend/src/test/common/authz/__snapshots__/route-policies.spec.ts.snap');
const ALLOWLIST = path.join(ROOT, 'test/contract/api-paths-unmatched.json');
const PLACEHOLDER = ':x';

function backendRoutes(): string[][] {
  const out: string[][] = [];
  for (const line of fs.readFileSync(SNAPSHOT, 'utf8').split('\n')) {
    const m = /^"?\S+\s+(?:GET|POST|PUT|PATCH|DELETE)\s+\/v1\/api\/(\S+)\s/.exec(line);
    if (m) out.push(m[1].split('/'));
  }
  return out;
}

/** The text of a string or template literal with each ${…} as a placeholder segment, or null when it is not one. */
function literalText(node: ts.Node, source: string): string | null {
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return node.text;
  if (!ts.isTemplateExpression(node)) return null;
  let out = node.head.text;
  for (const span of node.templateSpans) {
    const expr = span.expression.getText();
    out += (/endpoints\.api\.v1|baseUrl|API_URL|backendUrl/.test(expr) && out === '' ? '' : '\u0001') + span.literal.text;
  }
  void source;
  return out;
}

function apiPathsOf(file: string): Array<{ file: string; path: string }> {
  const source = fs.readFileSync(path.join(ROOT, file), 'utf8');
  const sf = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, file.endsWith('x') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const found: Array<{ file: string; path: string }> = [];
  const add = (node: ts.Node) => {
    const text = literalText(node, source);
    if (text === null) return;
    const rest = text.replace(/^\u0001(?=\/)/, '');
    if (!rest.startsWith('/')) return;
    let p = rest.split('?')[0];
    p = p.replace(/([^/])\u0001[^/]*$/, '$1'); // a placeholder glued to the last segment's text is a query string or suffix
    const segments = p.slice(1).split('/').map((s) => (s.includes('\u0001') ? PLACEHOLDER : s)).filter((s, i, a) => !(s === '' && i === a.length - 1));
    if (segments.length) found.push({ file, path: '/' + segments.join('/') });
  };
  const apiFile = file.startsWith('lib/api/');
  (function visit(n: ts.Node) {
    if (ts.isCallExpression(n) && /^apiClient\.(get|post|put|patch|delete)$/.test(n.expression.getText()) && n.arguments[0]) add(n.arguments[0]);
    else if (apiFile && (ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n) || ts.isTemplateExpression(n))) add(n);
    ts.forEachChild(n, visit);
  })(sf);
  return found;
}

const files = execSync("git ls-files 'app/**/*.ts' 'app/**/*.tsx' 'components/**/*.ts' 'components/**/*.tsx' 'lib/**/*.ts' 'lib/**/*.tsx' 'hooks/**/*.ts' 'hooks/**/*.tsx'", { cwd: ROOT, encoding: 'utf8' })
  .trim().split('\n').filter((f) => !f.endsWith('.d.ts'));

const calls = files.flatMap(apiPathsOf);
const routes = backendRoutes();

const served = (segments: string[]) =>
  routes.some((r) => r.length === segments.length && r.every((part, i) => part.startsWith(':') || segments[i] === PLACEHOLDER || part === segments[i]));

// Literals in lib/api that are not endpoints at all (URLs of the app's own pages, other servers, file names) are not paths to check:
// a path counts only when its first segment is a backend resource.
const NOT_ENDPOINTS = new Set(['health', 'status', 'tracking', 'api', 'v1', 'members', 'workspaces', 'ready', 'live']);
const apiCalls = calls.filter((c) => !NOT_ENDPOINTS.has(c.path.split('/')[1]));

const unmatched = [...new Set(apiCalls.filter((c) => !served(c.path.slice(1).split('/'))).map((c) => `${c.file}: ${c.path}`))].sort();

describe('the web app calls only routes the backend serves', () => {
  it('finds the web app\'s API calls', () => {
    expect(apiCalls.length).toBeGreaterThan(300);
  });

  it('every path is a canonical route; the unmatched list only shrinks', () => {
    if (process.env.UPDATE_API_PATHS === '1') {
      fs.writeFileSync(ALLOWLIST, JSON.stringify(unmatched, null, 2) + '\n');
      return;
    }
    const allowed: string[] = JSON.parse(fs.readFileSync(ALLOWLIST, 'utf8'));
    expect({ added: unmatched.filter((u) => !allowed.includes(u)), stale: allowed.filter((u) => !unmatched.includes(u)) }).toEqual({ added: [], stale: [] });
  });
});
