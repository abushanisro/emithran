// Decisions main.ts makes before Nest (and its ConfigModule) exists, from the process environment alone. Pure, so they are tested.

type Env = Record<string, string | undefined>;

/**
 * Swagger UI and the OpenAPI document at /docs. Off in production (they map every route, unauthenticated) unless
 * ENABLE_API_DOCS=true says otherwise; on elsewhere unless ENABLE_API_DOCS=false.
 */
export function apiDocsEnabled(env: Env): boolean {
  if (env.NODE_ENV === 'production') return env.ENABLE_API_DOCS === 'true';
  return env.ENABLE_API_DOCS !== 'false';
}

/**
 * Whether the repo-root .env may override variables already in the environment. Only on a local development machine, where the
 * one shared .env is meant to win over stale shell exports; anywhere else (a container, stage, production) the environment the
 * deployment set is authoritative and a stray .env file must not replace it.
 */
export function dotenvOverride(env: Env): boolean {
  return env.NODE_ENV !== 'production' && (env.APP_ENV ?? 'local') === 'local';
}
