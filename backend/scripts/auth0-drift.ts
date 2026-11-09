#!/usr/bin/env ts-node
/**
 * Does the live Auth0 tenant still match what sign-in needs (auth0/tenant.yaml)? Read-only: it only reads through the Management API.
 * Needs AUTH0_MGMT_CLIENT_ID and AUTH0_MGMT_CLIENT_SECRET (a machine-to-machine app with read scopes, kept in your shell, never in .env
 * or the repo), plus the usual AUTH0_* settings from the root .env.
 *   npm run auth0:drift
 */
import * as fs from 'fs';
import * as path from 'path';
import { parseEnv } from 'util';

import { tenantDrift } from '../src/modules/auth/auth0-tenant-rules';

const ACTION_NAME = 'emithran-claims';
const rootEnv = path.resolve(__dirname, '../../.env');
const settings: Record<string, string | undefined> = { ...(fs.existsSync(rootEnv) ? parseEnv(fs.readFileSync(rootEnv, 'utf8')) : {}), ...process.env };

async function main(): Promise<void> {
  const domain = (settings.AUTH0_DOMAIN ?? '').replace(/^https?:\/\//, '').replace(/\/+$/, '');
  const { AUTH0_MGMT_CLIENT_ID: id, AUTH0_MGMT_CLIENT_SECRET: secret, AUTH0_CLIENT_ID: clientId, AUTH0_AUDIENCE: audience, APP_BASE_URL: appBaseUrl } = settings;
  if (!domain || !id || !secret || !clientId || !audience || !appBaseUrl) {
    console.log('FAIL needs AUTH0_DOMAIN, AUTH0_CLIENT_ID, AUTH0_AUDIENCE, APP_BASE_URL (root .env) and AUTH0_MGMT_CLIENT_ID, AUTH0_MGMT_CLIENT_SECRET (your shell). See auth0/README.md.');
    process.exit(1);
  }

  const tokenRes = await fetch(`https://${domain}/oauth/token`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ grant_type: 'client_credentials', client_id: id, client_secret: secret, audience: `https://${domain}/api/v2/` }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!tokenRes.ok) {
    console.log(`FAIL could not get a Management API token (HTTP ${tokenRes.status}): check the M2M app's id, secret and that it is authorized for the Management API`);
    process.exit(1);
  }
  const { access_token: token } = (await tokenRes.json()) as { access_token: string };
  const get = async <T>(p: string): Promise<T> => {
    const res = await fetch(`https://${domain}/api/v2${p}`, { headers: { authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(10_000) });
    if (!res.ok) throw new Error(`GET ${p} answered ${res.status} (the M2M app needs the matching read: scope)`);
    return (await res.json()) as T;
  };

  type Connection = { id: string; name: string; strategy: string; options?: { disable_signup?: boolean }; enabled_clients?: string[] };
  const [client, allConnections, apis, grants, actions, bindings] = await Promise.all([
    get<{ app_type?: string; callbacks?: string[]; allowed_logout_urls?: string[] }>(`/clients/${encodeURIComponent(clientId)}`).catch(() => undefined),
    get<Connection[]>('/connections?per_page=100'),
    get<{ identifier: string; signing_alg?: string }[]>('/resource-servers?per_page=100'),
    get<{ client_id: string; audience: string }[]>(`/client-grants?client_id=${encodeURIComponent(clientId)}&per_page=100`),
    get<{ actions: { name: string; id: string; all_changes_deployed?: boolean; deployed?: boolean }[] }>(`/actions/actions?triggerId=post-login&actionName=${ACTION_NAME}`),
    get<{ bindings: { display_name?: string; action?: { name: string } }[] }>('/actions/triggers/post-login/bindings'),
  ]);

  const api = apis.find((a) => a.identifier === audience);
  const action = actions.actions.find((a) => a.name === ACTION_NAME);
  const problems = tenantDrift(
    {
      ...(client && { client }),
      connections: allConnections.filter((c) => c.enabled_clients?.includes(clientId)).map((c) => ({ name: c.name, strategy: c.strategy, ...(c.options && { options: c.options }) })),
      ...(api && { api }),
      grantExists: grants.some((g) => g.audience === audience),
      actionDeployed: action?.deployed === true || action?.all_changes_deployed === true,
      actionBound: bindings.bindings.some((b) => b.action?.name === ACTION_NAME),
    },
    { appBaseUrl, dbConnection: settings.AUTH0_DB_CONNECTION ?? 'Username-Password-Authentication', actionName: ACTION_NAME },
  );

  if (problems.length === 0) console.log(`ok   tenant ${domain} matches auth0/tenant.yaml's rules`);
  for (const problem of problems) console.log(`FAIL ${problem}`);
  process.exit(problems.length ? 1 : 0);
}

main().catch((error: unknown) => {
  console.log(`FAIL ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
