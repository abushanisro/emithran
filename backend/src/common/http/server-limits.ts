import type { HttpServerLimits } from '../resource-limits';
import type { Server } from 'node:http';


/**
 * Sets the connection limits on the API's HTTP server (values and defaults in common/resource-limits.ts), so a client that sends
 * its headers or body slowly, or thousands of headers, cannot hold a connection and its memory open (slowloris). Node checks the
 * header and request deadlines on its connectionsCheckingInterval (30 s), so a deadline is enforced within that much of expiring.
 */
export function applyServerLimits(server: Server, limits: HttpServerLimits): void {
  server.requestTimeout = limits.requestTimeoutMs;
  server.headersTimeout = limits.headersTimeoutMs;
  server.keepAliveTimeout = limits.keepAliveTimeoutMs;
  server.maxHeadersCount = limits.maxHeadersCount;
}
