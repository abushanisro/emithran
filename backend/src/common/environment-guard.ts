// The e2e suites sign in, create projects, BOMs, items and files, and delete them again. They are for local and stage only.
// This says whether a given environment is production, so the suites can refuse to start instead of trusting whoever
// runs them to have checked which database they are pointed at.

/** The production Supabase project host. A public identifier, not a secret. */
export const PRD_SUPABASE_HOST = 'udvcydhvlgjfsohueryv.supabase.co';

type Env = Record<string, string | undefined>;

const SUPABASE_URL_VARIABLES = ['SUPABASE_URL', 'NEXT_PUBLIC_SUPABASE_URL'] as const;

function hostOf(url: string | undefined): string | null {
  try {
    return url ? new URL(url).hostname.toLowerCase() : null;
  } catch {
    return null;
  }
}

/** Why this environment counts as production, or null when it does not. */
export function productionReason(env: Env): string | null {
  if (env.APP_ENV === 'prd') return 'APP_ENV is "prd"';
  for (const name of SUPABASE_URL_VARIABLES) {
    if (hostOf(env[name]) === PRD_SUPABASE_HOST) return `${name} points at the production Supabase project`;
  }
  return null;
}

export function assertNotProduction(env: Env): void {
  const reason = productionReason(env);
  if (reason) {
    throw new Error(
      `Refusing to run the data-creating e2e suites: ${reason}. They create and delete real rows and files. ` +
        'Point them at local or stage (APP_ENV=local|stage and the stage Supabase URL).',
    );
  }
}
