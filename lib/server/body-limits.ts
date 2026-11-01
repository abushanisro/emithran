/**
 * Request body ceilings for the Next server. No imports: next.config.ts reads this file at build time.
 *
 * Next.js buffers a copy of every body that passes through proxy.ts and silently truncates it at proxyClientMaxBodySize. Truncation
 * cannot be turned into a refusal, so the proxy limit is set above every limit the route handlers enforce: a body a route would accept
 * is never truncated, and a larger one is refused with 413 by the route (lib/server/read-body.ts) or the BFF, never cut short.
 */

const MIB = 1024 * 1024;

/** Largest body any route handler or the BFF accepts: a 50 MB upload (MAX_UPLOAD_MB) plus multipart framing. */
export const MAX_REQUEST_BODY_BYTES = 52 * MIB;

/** proxyClientMaxBodySize: above MAX_REQUEST_BODY_BYTES, so the routes' own limits always decide first. */
export const PROXY_CLIENT_MAX_BODY_BYTES = MAX_REQUEST_BODY_BYTES + MIB;
