#!/usr/bin/env ts-node
/**
 * Is the Auth0 tenant ready for the backend? Reads the AUTH0_* settings (environment or root .env) and checks, over the public internet only:
 * the tenant answers, its issuer is what the backend will demand, it publishes an RS256 signing key (the only algorithm the backend
 * accepts), and every setting the backend and the frontend need is present and well formed. Sends no secret anywhere.
 *   npm run auth0:check
 */
import * as fs from 'fs';
import * as path from 'path';
import { parseEnv } from 'util';

const rootEnv = path.resolve(__dirname, '../../.env');
const settings: Record<string, string | undefined> = { ...(fs.existsSync(rootEnv) ? parseEnv(fs.readFileSync(rootEnv, 'utf8')) : {}), ...process.env };

let failed = false;
const ok = (message: string) => console.log(`ok   ${message}`);
const bad = (message: string) => { failed = true; console.log(`FAIL ${message}`); };
const check = (condition: boolean, good: string, problem: string) => (condition ? ok(good) : bad(problem));

async function main(): Promise<void> {
  const domain = (settings.AUTH0_DOMAIN ?? '').replace(/^https?:\/\//, '').replace(/\/+$/, '');
  const audience = settings.AUTH0_AUDIENCE ?? '';
  const namespace = settings.AUTH0_CLAIM_NAMESPACE ?? '';

  check(/^[a-z0-9-]+(\.[a-z0-9-]+)*\.auth0\.com$|^[a-z0-9.-]+\.[a-z]{2,}$/i.test(domain), `AUTH0_DOMAIN is ${domain}`, 'AUTH0_DOMAIN is missing or not a host name (e.g. your-tenant.eu.auth0.com)');
  check(/^https?:\/\/\S+$/.test(audience), `AUTH0_AUDIENCE is ${audience}`, 'AUTH0_AUDIENCE is missing (the API identifier you created in Auth0, e.g. https://api.emithran.com)');
  check(/^https?:\/\/\S+\/$/.test(namespace), `AUTH0_CLAIM_NAMESPACE is ${namespace}`, 'AUTH0_CLAIM_NAMESPACE must be a URL ending in "/" (e.g. https://emithran.com/), the same one the post-login Action uses');
  check((settings.AUTH0_SECRET ?? '').length >= 32, 'AUTH0_SECRET is set', 'AUTH0_SECRET is missing or short (openssl rand -hex 32)');
  check(!!settings.AUTH0_CLIENT_ID, 'AUTH0_CLIENT_ID is set', 'AUTH0_CLIENT_ID is missing (from the Regular Web Application)');
  check(!!settings.AUTH0_CLIENT_SECRET, 'AUTH0_CLIENT_SECRET is set', 'AUTH0_CLIENT_SECRET is missing (from the Regular Web Application)');
  check(/^https?:\/\/\S+$/.test(settings.APP_BASE_URL ?? ''), `APP_BASE_URL is ${settings.APP_BASE_URL}`, 'APP_BASE_URL is missing (http://localhost:3000 in development)');

  if (domain) {
    try {
      const res = await fetch(`https://${domain}/.well-known/openid-configuration`, { signal: AbortSignal.timeout(8_000) });
      const config = (await res.json()) as { issuer?: string; jwks_uri?: string };
      check(res.ok && config.issuer === `https://${domain}/`, `the tenant answers and its issuer is https://${domain}/ (what the backend demands)`, `the tenant did not answer correctly (HTTP ${res.status}, issuer ${config.issuer ?? 'none'})`);
      if (config.jwks_uri) {
        const keys = ((await (await fetch(config.jwks_uri, { signal: AbortSignal.timeout(8_000) })).json()) as { keys?: { alg?: string; use?: string }[] }).keys ?? [];
        check(keys.some((k) => k.alg === 'RS256' && k.use === 'sig'), `the tenant publishes ${keys.length} signing key(s), including RS256`, 'no RS256 signing key published: set the API signing algorithm to RS256');
      }
    } catch (error) {
      bad(`could not reach https://${domain}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  console.log(failed ? '\nNot ready. Fix the FAIL lines, then run this again.' : '\nReady. Restart the backend and the web app.');
  process.exit(failed ? 1 : 0);
}

void main();
