// The e2e suites sign in, create projects, BOMs, items and files, and delete them again. They are for local and stage only.
// This says whether a given environment is production, so the suites can refuse to start instead of trusting whoever
// runs them to have checked which database they are pointed at.

type Env = Record<string, string | undefined>;

/** Why this environment counts as production, or null when it does not. */
export function productionReason(env: Env): string | null {
  if (env.APP_ENV === 'prd') return 'APP_ENV is "prd"';
  return null;
}

export function assertNotProduction(env: Env): void {
  const reason = productionReason(env);
  if (reason) {
    throw new Error(
      `Refusing to run the data-creating e2e suites: ${reason}. They create and delete real rows and files. ` +
        'Point them at local or stage (APP_ENV=local|stage).',
    );
  }
}
