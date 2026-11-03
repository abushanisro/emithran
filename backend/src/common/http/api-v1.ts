import type { NextFunction, Request, Response } from 'express';

import { renamedPath } from './legacy-paths';

/**
 * The public API prefix is /api/v1 (docs/API.md). The controllers were written under /v1/api (Nest's URI version 1 plus the
 * `api/...` controller paths), so the new prefix is an alias for them: a request to /api/v1/<path> is routed exactly as /v1/api/<path>.
 *
 * - New prefix: the request is marked (`apiV1`), so errors are answered as RFC 9457 problem details (GlobalExceptionFilter).
 * - Old prefix: still served, unchanged, but announced as deprecated (Deprecation, Link to the successor, and Sunset when
 *   LEGACY_API_SUNSET names the date). Its request log is the measure of who still uses it; it is removed once that has been zero
 *   for 30 days.
 * Health checks (/api/health/*) are not under either prefix and are left alone.
 */
const NEW_PREFIX = '/api/v1/';
const OLD_PREFIX = '/v1/api/';

export interface ApiV1Request extends Request {
  apiV1?: boolean;
}

export function apiV1Middleware(env: Record<string, string | undefined> = process.env) {
  const deprecate = (res: Response, successor: string): void => {
    res.setHeader('Deprecation', 'true');
    res.setHeader('Link', `<${successor}>; rel="successor-version"`);
    if (env.LEGACY_API_SUNSET) res.setHeader('Sunset', env.LEGACY_API_SUNSET);
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
