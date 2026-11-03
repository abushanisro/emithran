import type { NextFunction, Request, Response } from 'express';

import { renamedPath } from './legacy-paths';

/**
 * The public API prefix is /api/v1 (docs/API.md). The controllers were written under /v1/api (Nest's URI version 1 plus the
 * `api/...` controller paths), so the new prefix is an alias for them: a request to /api/v1/<path> is routed exactly as /v1/api/<path>.
 *
 * - New prefix: the request is marked (`apiV1`), so errors are answered as RFC 9457 problem details (GlobalExceptionFilter).
 * - Old prefix (and an old resource name): still served, but announced as deprecated with the standard headers:
 *     Deprecation  RFC 9745: the date it was deprecated, as a structured date (`@1793664000`), not a boolean
 *     Sunset       RFC 8594: the date it stops working, once LEGACY_API_SUNSET names it (an HTTP-date)
 *     Link         rel="successor-version" to the new path, and rel="deprecation" to the notice when API_DEPRECATION_DOCS_URL is set
 *   The request log says who still calls it, but zero traffic is not what removes it: an integration may run once a quarter. It goes
 *   after the Sunset date, announced in advance (docs/API.md).
 * Health checks (/api/health/*) are not under either prefix and are left alone.
 */
const NEW_PREFIX = '/api/v1/';
const OLD_PREFIX = '/v1/api/';

export interface ApiV1Request extends Request {
  apiV1?: boolean;
}

/** When the old prefix and the old resource names were deprecated (UTC midnight), unless LEGACY_API_DEPRECATED_AT says otherwise. */
export const DEFAULT_DEPRECATED_AT = '2026-11-03';

/**
 * The deprecation headers from the environment, read once at start so a wrong value stops the server instead of going out on
 * every response: LEGACY_API_DEPRECATED_AT (a date, default above), LEGACY_API_SUNSET (a date, never before the deprecation date)
 * and API_DEPRECATION_DOCS_URL (an https URL).
 */
export function deprecationHeaders(env: Record<string, string | undefined>): { deprecation: string; sunset?: string; docs?: string } {
  const parse = (name: string, value: string): number => {
    const t = Date.parse(value);
    if (Number.isNaN(t)) throw new Error(`${name} is not a date: ${value}`);
    return t;
  };
  const deprecatedAt = parse('LEGACY_API_DEPRECATED_AT', env.LEGACY_API_DEPRECATED_AT || DEFAULT_DEPRECATED_AT);
  const out: { deprecation: string; sunset?: string; docs?: string } = { deprecation: `@${Math.floor(deprecatedAt / 1000)}` };
  if (env.LEGACY_API_SUNSET) {
    const sunsetAt = parse('LEGACY_API_SUNSET', env.LEGACY_API_SUNSET);
    if (sunsetAt < deprecatedAt) throw new Error('LEGACY_API_SUNSET is before the deprecation date');
    out.sunset = new Date(sunsetAt).toUTCString();
  }
  if (env.API_DEPRECATION_DOCS_URL) {
    if (!/^https:\/\/\S+$/.test(env.API_DEPRECATION_DOCS_URL)) throw new Error('API_DEPRECATION_DOCS_URL must be an https URL');
    out.docs = env.API_DEPRECATION_DOCS_URL;
  }
  return out;
}

export function apiV1Middleware(env: Record<string, string | undefined> = process.env) {
  const headers = deprecationHeaders(env);
  const deprecate = (res: Response, successor: string): void => {
    res.setHeader('Deprecation', headers.deprecation);
    const links = [`<${successor}>; rel="successor-version"`];
    if (headers.docs) links.push(`<${headers.docs}>; rel="deprecation"; type="text/html"`);
    res.setHeader('Link', links.join(', '));
    if (headers.sunset) res.setHeader('Sunset', headers.sunset);
  };

  return (req: ApiV1Request, res: Response, next: NextFunction): void => {
    const viaNew = req.url.startsWith(NEW_PREFIX);
    if (!viaNew && !req.url.startsWith(OLD_PREFIX)) return next();

    const rest = req.url.slice((viaNew ? NEW_PREFIX : OLD_PREFIX).length);
    const queryAt = rest.indexOf('?');
    const path = queryAt === -1 ? rest : rest.slice(0, queryAt);
    const query = queryAt === -1 ? '' : rest.slice(queryAt);
    const renamed = renamedPath(path);

    req.url = OLD_PREFIX + (renamed ?? path) + query;
    if (viaNew) {
      req.apiV1 = true;
      if (renamed) deprecate(res, NEW_PREFIX + renamed); // the new prefix with a path that has since been renamed
    } else {
      deprecate(res, NEW_PREFIX + (renamed ?? path)); // the old prefix
    }
    next();
  };
}
