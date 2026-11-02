import type { NextFunction, Request, Response } from 'express';

import { addActiveHttpRequests, recordHttpRejection, recordHttpServerDuration, statusClassOf } from './metrics';

// The matched route PATTERN (`/v1/bom-items/:id/apply-route`), never the URL: patterns are a closed
// set, URLs carry ids. Anything that is not a plain string pattern (no match, regex routes) is "unmatched".
export function routeTemplate(request: { route?: { path?: unknown } }): string {
  const path = request.route?.path;
  return typeof path === 'string' ? path : 'unmatched';
}

// Recording a metric must never throw into the request path.
const safely = (fn: () => void): void => {
  try {
    fn();
  } catch {
    // ignored by design
  }
};

// Registered only when telemetry is on (main.ts), with app.use(), so it sees EVERY request: guard
// rejections (401/403/429) and 404s included. A Nest interceptor would miss those, since guards run
// before interceptors, and they are exactly the error rates worth watching. It reads the response
// status when the response closes (after any exception filter) and never touches the request,
// the response body or the stream.
export function httpMetricsMiddleware(request: Request, response: Response, next: NextFunction): void {
  const started = process.hrtime.bigint();
  safely(() => addActiveHttpRequests(1));
  response.once('close', () => {
    safely(() => addActiveHttpRequests(-1));
    try {
      const route = routeTemplate(request);
      recordHttpServerDuration(
        Number(process.hrtime.bigint() - started) / 1e9,
        request.method,
        route,
        response.writableFinished ? statusClassOf(response.statusCode) : 'aborted',
      );
      const status = response.statusCode;
      if (status === 413 || status === 429) recordHttpRejection(request.method, route, status);
    } catch {
      // Recording a metric must never throw into the response lifecycle.
    }
  });
  next();
}
