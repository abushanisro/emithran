'use strict';

/**
 * Rules that keep the database trust boundary mechanical. Pure functions over
 * source text so the CLI (check-rls-bypass.js) and the jest spec share one
 * definition. See backend/docs/rls-bypass-inventory.md.
 *
 * The one place allowed to build or hand out the service-role client is
 * SupabaseService. Everything else must go through:
 *   getUserClient()/getClient(token)        RLS-enforced, tenant data
 *   getPrivilegedClient('<specific reason>') service role, named and reviewable
 */

const SUPABASE_SERVICE = 'src/common/supabase/supabase.service.ts';

// The platform database layer (Design Doc 9) is the one place a Postgres driver may be imported; feature code reaches
// data through withTenant() there, never through a driver of its own.
const PLATFORM_DB = 'src/platform/db/';
const PLATFORM_DRIVERS = new Set(['pg', 'kysely']);

const MIN_REASON_LENGTH = 10;

function lineOf(text, index) {
  return text.slice(0, index).split('\n').length;
}

/** @returns {{rule:string,line:number,message:string,severity:'error'|'warning'}[]} */
function scanSource(relPath, text) {
  const path = relPath.replace(/\\/g, '/');
  const out = [];
  const add = (rule, index, message, severity = 'error') =>
    out.push({ rule, line: lineOf(text, index), message, severity });
  const isService = path === SUPABASE_SERVICE;

  // 1. The unnamed service-role getter on SupabaseService.
  for (const m of text.matchAll(/\b\w*[sS]upabase\w*\.client\b/g)) {
    if (isService) continue;
    add('dot-client', m.index, `".client" returns the service-role client unnamed; use getUserClient() or getPrivilegedClient('<reason>')`);
  }

  // 2. The removed unnamed admin accessor must not come back.
  for (const m of text.matchAll(/\bgetAdminClient\s*\(/g)) {
    if (isService) continue;
    add('get-admin-client', m.index, "getAdminClient() was removed; use getPrivilegedClient('<reason>')");
  }

  // 3. Every privileged access must carry a literal, searchable reason.
  if (!isService) {
    for (const m of text.matchAll(/getPrivilegedClient\s*\(/g)) {
      const rest = text.slice(m.index + m[0].length);
      const lit = rest.match(/^\s*(['"])([^'"\n]*)\1/);
      if (!lit) {
        add('privileged-reason', m.index, 'getPrivilegedClient needs a plain string-literal reason (no variables or template strings) so every bypass is greppable');
      } else if (lit[2].trim().length < MIN_REASON_LENGTH) {
        add('privileged-reason', m.index, `getPrivilegedClient reason "${lit[2]}" is too short to explain the bypass`);
      }
    }
  }

  // 4. A user-scoped client must never be requested without a token.
  for (const m of text.matchAll(/\.getClient\s*\(\s*\)/g)) {
    add('getclient-no-token', m.index, 'getClient() without a token; use getUserClient()');
  }
  for (const m of text.matchAll(/\.getClient\s*\([^)\n]*(\?\?|\|\|)\s*(undefined|null)/g)) {
    add('getclient-optional-token', m.index, 'getClient() must not receive a possibly-missing token; use getUserClient(token)');
  }

  // 5. No database path besides SupabaseService and the platform database layer.
  for (const m of text.matchAll(/(?:from\s+|require\(\s*)['"](typeorm|knex|nestjs-knex|pg|kysely|@nestjs\/typeorm)['"]/g)) {
    if (path.startsWith(PLATFORM_DB) && PLATFORM_DRIVERS.has(m[1])) continue;
    add('second-db-path', m.index, `importing "${m[1]}" adds a second database path that bypasses RLS`);
  }

  // 6. Service-role clients and keys are built only inside SupabaseService.
  if (!isService) {
    for (const m of text.matchAll(/\bcreateClient\s*\(/g)) {
      add('own-supabase-client', m.index, 'building a Supabase client outside SupabaseService; use getUserClient()/getPrivilegedClient()');
    }
    if (!path.startsWith('src/config/')) {
      for (const m of text.matchAll(/SUPABASE_SERVICE_KEY|SUPABASE_SERVICE_ROLE/g)) {
        add('service-key-outside-boundary', m.index, `${m[0]} read outside SupabaseService`);
      }
    }
  }

  // 7. Never a literal JWT in source.
  for (const m of text.matchAll(/eyJ[A-Za-z0-9_-]{15,}\.eyJ[A-Za-z0-9_-]{15,}\.[A-Za-z0-9_-]{10,}/g)) {
    add('hardcoded-jwt', m.index, 'a JWT literal is committed in source; remove it and rotate the key');
  }

  return out;
}

/**
 * Repository-wide secret check, run over every tracked file (docs, scripts,
 * compose files, frontend, tests). A service_role JWT literal is always an
 * error. Any other JWT literal (e.g. a public anon key) is a warning.
 */
function scanRepoJwt(relPath, text) {
  const out = [];
  const re = /eyJ[A-Za-z0-9_-]{15,}\.eyJ[A-Za-z0-9_-]{15,}\.[A-Za-z0-9_-]{10,}/g;
  for (const m of text.matchAll(re)) {
    let role;
    try {
      role = JSON.parse(Buffer.from(m[0].split('.')[1], 'base64url').toString('utf8')).role;
    } catch {
      role = undefined;
    }
    const isService = role === 'service_role';
    out.push({
      rule: isService ? 'service-role-jwt-literal' : 'jwt-literal',
      line: lineOf(text, m.index),
      message: isService
        ? 'a service_role JWT is committed; remove it and rotate the key'
        : 'a JWT literal is committed; prefer an environment variable',
      severity: isService ? 'error' : 'warning',
    });
  }
  return out;
}

/** Privileged-client calls in one file; the CLI compares these per file with rls-bypass-baseline.json. */
function countPrivilegedCalls(text) {
  return [...text.matchAll(/getPrivilegedClient\s*\(/g)].length;
}

/**
 * Files whose privileged-call count differs from the baseline. Both directions fail the check: an increase is a new
 * RLS bypass, and a decrease must be recorded so the budget only goes down.
 * @returns {{increased:{file:string,baseline:number,now:number}[], decreased:{file:string,baseline:number,now:number}[]}}
 */
function compareToBaseline(counts, baseline) {
  const files = [...new Set([...Object.keys(counts), ...Object.keys(baseline)])].sort();
  const rows = files.map((file) => ({ file, baseline: baseline[file] ?? 0, now: counts[file] ?? 0 }));
  return {
    increased: rows.filter((r) => r.now > r.baseline),
    decreased: rows.filter((r) => r.now < r.baseline),
  };
}

/** The baseline lowered to current counts. It never raises an entry or adds a file: that is a reviewed hand edit. */
function lowerBaseline(counts, baseline) {
  const lowered = {};
  for (const file of Object.keys(baseline).sort()) {
    const now = Math.min(baseline[file], counts[file] ?? 0);
    if (now > 0) lowered[file] = now;
  }
  return lowered;
}

/** @returns {Record<string, number>} */
function parseBaseline(text) {
  const parsed = JSON.parse(text);
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new Error('baseline must be a JSON object of "file": count');
  }
  for (const [file, count] of Object.entries(parsed)) {
    if (!Number.isInteger(count) || count < 1) throw new Error(`baseline entry ${file} must be a positive integer`);
  }
  return parsed;
}

module.exports = { scanSource, scanRepoJwt, countPrivilegedCalls, compareToBaseline, lowerBaseline, parseBaseline, SUPABASE_SERVICE };
