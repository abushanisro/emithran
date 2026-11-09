/**
 * What the live Auth0 tenant must look like for sign-in to work (the rules behind auth0/tenant.yaml). Pure: takes a snapshot of the
 * tenant read through the Management API and returns one sentence per drift. Used by `npm run auth0:drift`.
 */

export interface TenantSnapshot {
  client?: { app_type?: string; callbacks?: string[]; allowed_logout_urls?: string[] };
  /** Every connection enabled for the web application. */
  connections: { name: string; strategy: string; options?: { disable_signup?: boolean } }[];
  api?: { signing_alg?: string };
  grantExists: boolean;
  actionDeployed: boolean;
  actionBound: boolean;
}

export interface TenantExpectation {
  appBaseUrl: string;
  dbConnection: string;
  actionName: string;
}

/** Logins an invited-only product may offer: the database connection and company (enterprise) identity providers. Never public social. */
const ALLOWED_STRATEGIES = new Set(['auth0', 'google-apps', 'waad', 'samlp', 'oidc', 'okta', 'adfs', 'ad', 'ping-federate']);

export function tenantDrift(snapshot: TenantSnapshot, expected: TenantExpectation): string[] {
  const problems: string[] = [];
  const base = expected.appBaseUrl.replace(/\/+$/, '');

  const { client } = snapshot;
  if (!client) {
    problems.push('the web application (AUTH0_CLIENT_ID) was not found in the tenant');
  } else {
    if (client.app_type !== 'regular_web') problems.push(`the web application type is "${client.app_type ?? 'none'}", expected regular_web`);
    const callbacks = client.callbacks ?? [];
    if (!callbacks.includes(`${base}/auth/callback`)) problems.push(`Allowed Callback URLs lack ${base}/auth/callback`);
    if (callbacks.some((url) => url.includes('*'))) problems.push('Allowed Callback URLs contain a wildcard');
    const logouts = client.allowed_logout_urls ?? [];
    if (!logouts.includes(base)) problems.push(`Allowed Logout URLs lack ${base}`);
    if (logouts.some((url) => url.includes('*'))) problems.push('Allowed Logout URLs contain a wildcard');
  }

  const database = snapshot.connections.find((c) => c.name === expected.dbConnection);
  if (!database) problems.push(`the database connection "${expected.dbConnection}" is not enabled for the web application`);
  else if (database.options?.disable_signup !== true) problems.push(`public sign-up is ON for "${expected.dbConnection}" (anyone can create an account)`);

  for (const connection of snapshot.connections) {
    if (!ALLOWED_STRATEGIES.has(connection.strategy)) {
      problems.push(`"${connection.name}" (${connection.strategy}) is enabled for the web application: a public social login must be off`);
    }
  }

  if (snapshot.api?.signing_alg !== 'RS256') problems.push(`the API signs tokens with ${snapshot.api?.signing_alg ?? 'nothing (API not found)'}, the backend accepts RS256 only`);
  if (!snapshot.grantExists) problems.push('the web application is not authorized for the API (Application Access > User Access > Authorized)');
  if (!snapshot.actionDeployed) problems.push(`the post-login Action "${expected.actionName}" is not deployed`);
  else if (!snapshot.actionBound) problems.push(`the post-login Action "${expected.actionName}" is deployed but not in the Login flow`);
  return problems;
}
