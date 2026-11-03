// API design rules (docs/API.md), checked against the route inventory (authz/__snapshots__/route-policies.spec.ts.snap):
//   verbs     the path names a thing, the HTTP method is the verb; only state changes (POST /things/:id/approve) are actions
//   plural    a collection is a plural noun (singletons such as /auth, /profile excepted)
//   depth     at most two levels of nesting: collection/:id/child/:id (4 segments); deeper children are top-level, filtered by the parent
//
// Existing routes that break a rule are listed in api-design-violations.json. The list can only shrink: a NEW violation fails, and
// so does an entry that is no longer a violation (remove it). After renaming or flattening routes:
//   UPDATE_API_DESIGN_VIOLATIONS=1 npx jest src/test/common/api-design.spec.ts
import * as fs from 'fs';
import * as path from 'path';

const SNAPSHOT = path.resolve(__dirname, 'authz/__snapshots__/route-policies.spec.ts.snap');
const ALLOWLIST = path.resolve(__dirname, 'api-design-violations.json');

/** Resources that exist once per caller or per deployment, so they have no plural. */
const SINGLETONS = new Set(['auth', 'profile', 'copilot', 'health', 'ping', 'me']);

/** State changes: POST /<collection>/:id/<action>. Anything else that reads like a verb is a violation. */
const ACTIONS = new Set(['send', 'close', 'approve', 'reject', 'submit', 'activate', 'archive', 'apply', 'discard', 'refresh', 'execute', 'reset', 'complete', 'resolve', 'reparse', 'reanalyze', 'reorder']);

/** An action is a POST; an existing one may be a PUT or PATCH. */
const ACTION_METHODS = new Set(['POST', 'PUT', 'PATCH']);

const VERB = /^(get|create|update|delete|remove|add|set|list|fetch|find|import|upload|download|export|analy[sz]e|calculate|recalculate|generate|select|validate|reanalyze|reparse|convert|start|complete|init|initialize|batch|bulk|store|save|check|match|detect|extract|run|record|compare|resolve|reorder|reset|clear|sync|verify|lookup|apply|discard|send|close|approve|reject|submit|activate|archive|refresh|execute)(-|$)/i;

interface Route { method: string; segments: string[]; text: string }

function routes(): Route[] {
  const out: Route[] = [];
  for (const line of fs.readFileSync(SNAPSHOT, 'utf8').split('\n')) {
    const m = /^"?(\S+)\s+(GET|POST|PUT|PATCH|DELETE)\s+(\S+)\s+\w+\.\w+/.exec(line);
    if (!m) continue;
    const full = m[3];
    if (!full.startsWith('/v1/api/')) continue; // health and ping live outside the API prefix
    const segments = full.replace(/^\/v1\/api\//, '').split('/').filter(Boolean);
    out.push({ method: m[2], segments, text: `${m[2]} /${segments.join('/')}` });
  }
  return out;
}

export function violationsOf(r: Route): string[] {
  const found: string[] = [];
  const named = r.segments.filter((s) => !s.startsWith(':'));
  const lastIsAction = r.segments.length >= 2 && !r.segments[r.segments.length - 1].startsWith(':'); // POST /things/:id/<action> or POST /things/<action>
  for (const s of named) {
    if (!VERB.test(s)) continue;
    const isAction = ACTION_METHODS.has(r.method) && lastIsAction && s === r.segments[r.segments.length - 1] && ACTIONS.has(s);
    if (!isAction) { found.push(`verb:${s}`); break; }
  }
  const top = r.segments[0];
  if (top && !top.startsWith(':') && !top.endsWith('s') && !SINGLETONS.has(top)) found.push(`plural:${top}`);
  if (r.segments.length >= 5) found.push('depth');
  return found;
}

const all = routes();
const current = all.flatMap((r) => violationsOf(r).map((v) => `${r.text} # ${v}`)).sort();

describe('API design rules', () => {
  it('reads every route of the inventory', () => {
    expect(all.length).toBeGreaterThan(400);
  });

  it('breaks no rule except the listed existing routes, and the list only shrinks', () => {
    if (process.env.UPDATE_API_DESIGN_VIOLATIONS === '1') {
      fs.writeFileSync(ALLOWLIST, JSON.stringify(current, null, 2) + '\n');
      return;
    }
    const allowed: string[] = JSON.parse(fs.readFileSync(ALLOWLIST, 'utf8'));
    const added = current.filter((v) => !allowed.includes(v));
    const stale = allowed.filter((v) => !current.includes(v));
    expect({ added, stale }).toEqual({ added: [], stale: [] });
    // added: a new route breaks a rule (docs/API.md): fix the route.  stale: a route was fixed: remove it from api-design-violations.json.
  });

  it.each([
    ['GET', 'projects', 0], ['POST', 'projects', 0], ['POST', 'rfqs/:id/send', 0], ['POST', 'bom-items/:id/analyses', 0],
    ['POST', 'exchange-rates/refresh', 0], ['PATCH', 'rfqs/:id/send', 0], ['GET', 'exchange-rates/refresh', 1], ['DELETE', 'rfqs/:id/send', 1], ['GET', 'bom-items/analyze-cad', 1], ['POST', 'lhr/import-excel', 2], ['GET', 'as/:id/bs/:id/cs', 1],
  ] as const)('%s /%s is judged as expected (%i violations)', (method, p, count) => {
    expect(violationsOf({ method, segments: p.split('/'), text: '' })).toHaveLength(count);
  });
});
