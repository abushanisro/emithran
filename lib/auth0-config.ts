/**
 * The web app's Auth0 settings, checked together. A missing or malformed one used to surface as a silent redirect to the sign-in page;
 * now every problem is named in one message (at server start, and again on first use). Pure: no network, nothing secret is returned.
 * The backend validates its own half in backend/src/config/env.validation.ts; `npm run auth0:check` (in backend/) checks both halves
 * and the tenant itself.
 */

/** Auth0's own session cookie. It must outlive the backend's 30-minute idle timer (the shorter limit, which ends the session), never cut it short. */
export const AUTH0_SESSION = {
  /** Seconds without a request before Auth0's cookie expires. Rolls forward on every request. */
  inactivityDuration: 8 * 60 * 60,
  /** Seconds after sign-in at which the session ends no matter what. */
  absoluteDuration: 24 * 60 * 60,
} as const;

const REQUIRED = ['AUTH0_DOMAIN', 'AUTH0_CLIENT_ID', 'AUTH0_CLIENT_SECRET', 'AUTH0_SECRET', 'AUTH0_AUDIENCE', 'APP_BASE_URL'] as const;

export function auth0ConfigProblems(env: Record<string, string | undefined>): string[] {
  const problems: string[] = [];
  for (const name of REQUIRED) if (!env[name]?.trim()) problems.push(`${name} is not set`);

  const domain = env.AUTH0_DOMAIN?.trim();
  if (domain && /^https?:\/\/|\/$/.test(domain)) problems.push('AUTH0_DOMAIN must be a bare host name (your-tenant.eu.auth0.com), without https:// or a trailing slash');
  if (env.AUTH0_SECRET && env.AUTH0_SECRET !== 'REPLACE_ME' && env.AUTH0_SECRET.length < 32) problems.push('AUTH0_SECRET is shorter than 32 characters (openssl rand -hex 32)');
  for (const name of ['AUTH0_SECRET', 'AUTH0_CLIENT_ID', 'AUTH0_CLIENT_SECRET'] as const) {
    if (env[name] === 'REPLACE_ME') problems.push(`${name} is still the REPLACE_ME placeholder from .env.example`);
  }
  const audience = env.AUTH0_AUDIENCE?.trim();
  if (audience && !/^https?:\/\/\S+$/.test(audience)) problems.push('AUTH0_AUDIENCE must be the API identifier URL from Auth0 (https://api.emithran.com)');

  const base = env.APP_BASE_URL?.trim();
  if (base) {
    try {
      const url = new URL(base);
      if (url.pathname !== '/' || url.search || url.hash) problems.push('APP_BASE_URL must be the site origin only (http://localhost:3000), with no path');
      if (env.NODE_ENV === 'production' && url.protocol !== 'https:') problems.push('APP_BASE_URL must be https in production');
    } catch {
      problems.push('APP_BASE_URL is not a valid URL');
    }
  }
  return problems;
}

/** Throws one error listing every problem; returns quietly when the settings are usable. */
export function assertAuth0Config(env: Record<string, string | undefined> = process.env): void {
  const problems = auth0ConfigProblems(env);
  if (problems.length) {
    throw new Error(`Auth0 is not configured correctly (see .env.example, then run "npm run auth0:check" in backend/):\n - ${problems.join('\n - ')}`);
  }
}
