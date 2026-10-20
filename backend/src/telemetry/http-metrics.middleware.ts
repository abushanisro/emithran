import type { NextFunction, Request, Response } from 'express';

import { recordHttpServerDuration, statusClassOf } from './metrics';

// The matched route PATTERN (`/v1/bom-items/:id/apply-route`), never the URL: patterns are a closed
// set, URLs carry ids. Anything that is not a plain string pattern (no match, regex routes) is "unmatched".
export function routeTemplate(request: { route?: { path?: unknown } }): string {
  const path = request.route?.path;
  return typeof path === 'string' ? path : 'unmatched';
}

// Registered only when telemetry is on (main.ts), with app.use(), so it sees EVERY request: guard
// rejections (401/403/429) and 404s included. A Nest interceptor would miss those, since guards run
// before interceptors, and they are exactly the error rates worth watching. It reads the response
// status when the response closes (after any exception filter) and never touches the request,
// the response body or the stream.
export function httpMetricsMiddleware(request: Request, response: Response, next: NextFunction): void {
  const started = process.hrtime.bigint();
  response.once('close', () => {
    try {
      recordHttpServerDuration(
        Number(process.hrtime.bigint() - started) / 1e9,
        request.method,
        routeTemplate(request),
        response.writableFinished ? statusClassOf(response.statusCode) : 'aborted',
      );
    } catch {
      // Recording a metric must never throw into the response lifecycle.
    }
  });
  next();
}
