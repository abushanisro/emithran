import { isIP } from 'net';

// The address of the person behind a request.
//
// In production the API is reachable only through a Cloudflare Tunnel, so the TCP peer is always the tunnel container and
// `req.ip` would be the same for every user: one shared rate-limit bucket, and useless audit logs. Cloudflare sets
// `CF-Connecting-IP` to the real client and overwrites any value the client sent. That header is trusted only when the
// deployment says so (TRUST_CLOUDFLARE_HEADERS=true), because on a server that is directly reachable anyone could forge it.

interface RequestLike {
  headers?: Record<string, string | string[] | undefined>;
  ip?: string;
  socket?: { remoteAddress?: string };
}

export function clientIp(request: RequestLike, trustCloudflareHeaders: boolean = process.env.TRUST_CLOUDFLARE_HEADERS === 'true'): string {
  if (trustCloudflareHeaders) {
    const header = request.headers?.['cf-connecting-ip'];
    const value = (Array.isArray(header) ? header[0] : header)?.trim();
    if (value && isIP(value) !== 0) return value;
  }
  return request.ip ?? request.socket?.remoteAddress ?? 'unknown';
}
