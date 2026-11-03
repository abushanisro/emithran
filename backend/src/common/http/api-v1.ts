import type { NextFunction, Request, Response } from 'express';

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
  return (req: ApiV1Request, res: Response, next: NextFunction): void => {
    if (req.url.startsWith(NEW_PREFIX)) {
      req.apiV1 = true;
      req.url = OLD_PREFIX + req.url.slice(NEW_PREFIX.length);
    } else if (req.url.startsWith(OLD_PREFIX)) {
      res.setHeader('Deprecation', 'true');
      res.setHeader('Link', `<${NEW_PREFIX}${req.url.slice(OLD_PREFIX.length).split('?')[0]}>; rel="successor-version"`);
      if (env.LEGACY_API_SUNSET) res.setHeader('Sunset', env.LEGACY_API_SUNSET);
    }
    next();
  };
}
