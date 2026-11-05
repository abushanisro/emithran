/**
 * The local development sign-in bypass: with it on, the app runs without an Auth0 login and the API acts as the account named by
 * ADMIN_FALLBACK_EMAIL (backend ALLOW_DEV_AUTH_BYPASS=true). It is for one developer's own machine.
 *
 * Two gates, both required, and neither can be set in a production build:
 *  - NODE_ENV is not "production" (a production build refuses it whatever else is set);
 *  - NEXT_PUBLIC_DEV_AUTH_BYPASS is exactly "true".
 * The API has its own second gate (backend/src/config/env.validation.ts refuses to boot with the bypass on in production), so a request without a
 * token is only ever served as the admin account by a non-production API that opted in.
 */
export function isDevAuthBypass(nodeEnv: string | undefined, flag: string | undefined): boolean {
  return nodeEnv !== 'production' && flag === 'true'
}

/** Read through literal `process.env.X` references so the client bundle inlines them (a dynamic lookup would not be replaced). */
export const devAuthBypassEnabled = (): boolean =>
  isDevAuthBypass(process.env.NODE_ENV, process.env.NEXT_PUBLIC_DEV_AUTH_BYPASS)
