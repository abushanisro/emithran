import { createHash } from 'node:crypto';
import type { Response } from 'express';

/**
 * Cache headers for an API response (docs/API.md rule 8).
 *
 * Reads: `Cache-Control: private, no-cache` (a client may keep the response but must ask again before using it; `private` because the
 * data belongs to one organization, so a shared cache never stores it) and an ETag computed from the DATA only. The response envelope
 * carries a timestamp and request id that change every time, so the ETag Express makes from the whole body never matched: with the
 * header set here Express answers a repeat request that sends If-None-Match with 304 and no body.
 * Everything else (create, update, delete): `no-store`.
 *
 * No `max-age`: members edit rates and reference data, and a browser that kept a list for minutes would show the old numbers after
 * an edit. A handler that sets its own Cache-Control (the copilot stream) is left alone.
 */
export function applyCacheHeaders(method: string, response: Response, body: unknown): void {
  if (response.headersSent) return;
  const readOnly = method === 'GET' || method === 'HEAD';
  if (response.getHeader('Cache-Control') === undefined) response.setHeader('Cache-Control', readOnly ? 'private, no-cache' : 'no-store');
  if (readOnly && body !== undefined && response.getHeader('ETag') === undefined) {
    response.setHeader('ETag', `W/"${createHash('sha1').update(JSON.stringify(body)).digest('base64url')}"`);
  }
}
