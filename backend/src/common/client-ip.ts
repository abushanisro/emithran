import { createHmac, timingSafeEqual } from 'node:crypto';
import { isIP } from 'node:net';

// The address of the person behind a request, for the pre-auth rate limit and the audit trail.
//
// In production nothing reaches the API except through the Cloudflare tunnel, by two paths:
// - the browser's calls go to the Next.js BFF, which calls the API itself, so the TCP peer is the frontend container for every
//   user. The BFF passes on the address it got from Cloudflare in X-Emithran-Client-Ip, signed with BFF_FORWARD_SECRET
//   (lib/server/bff/forward.ts). The address is used only when the signature is valid and fresh, so no one without the secret
//   can choose the address their requests are counted under;
// - integrations call /v1/* directly through the tunnel. Cloudflare sets CF-Connecting-IP to the real client and overwrites any
//   value the client sent, and the host publishes no port, so that header is honoured when the deployment says the tunnel is the
//   only way in (TRUST_CLOUDFLARE_HEADERS=true). The BFF never forwards it (its header allow-list).
// Otherwise the address is Express's req.ip, which follows X-Forwarded-For only for the explicit hops in TRUST_PROXY (never "true").

export const FORWARDED_CLIENT_IP_HEADER = 'x-emithran-client-ip';
export const FORWARDED_CLIENT_IP_SIGNATURE_HEADER = 'x-emithran-client-ip-signature';
/** How old a forwarded address's signature may be: the BFF signs each call as it sends it. */
export const FORWARD_SIGNATURE_MAX_AGE_SECONDS = 60;

interface RequestLike {
  headers?: Record<string, string | string[] | undefined>;
  ip?: string;
  socket?: { remoteAddress?: string };
}

export interface ClientIpSettings {
  trustCloudflareHeaders: boolean;
  /** The secret shared with the BFF; without it a forwarded address is never trusted. */
  bffForwardSecret?: string;
  nowSeconds?: () => number;
}

export function clientIpSettings(env: Record<string, string | undefined> = process.env): ClientIpSettings {
  const secret = env.BFF_FORWARD_SECRET;
  return { trustCloudflareHeaders: env.TRUST_CLOUDFLARE_HEADERS === 'true', bffForwardSecret: secret === '' ? undefined : secret };
}

/** The signature the BFF sends with a forwarded address: hex HMAC-SHA256 of "<unix seconds>.<address>", as "<seconds>.<hex>". */
export function signForwardedClientIp(secret: string, ip: string, nowSeconds: number): string {
  return `${nowSeconds}.${createHmac('sha256', secret).update(`${nowSeconds}.${ip}`).digest('hex')}`;
}

const single = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value)?.trim();

function verifiedForwardedIp(request: RequestLike, secret: string, nowSeconds: number): string | undefined {
  const ip = single(request.headers?.[FORWARDED_CLIENT_IP_HEADER]);
  const signature = single(request.headers?.[FORWARDED_CLIENT_IP_SIGNATURE_HEADER]);
  if (!ip || !signature || isIP(ip) === 0) return undefined;
  const match = /^(\d{1,12})\.([0-9a-f]{64})$/.exec(signature);
  if (!match) return undefined;
  const signedAt = Number(match[1]);
  if (Math.abs(nowSeconds - signedAt) > FORWARD_SIGNATURE_MAX_AGE_SECONDS) return undefined;
  const expected = Buffer.from(signForwardedClientIp(secret, ip, signedAt).split('.')[1], 'hex');
  return timingSafeEqual(expected, Buffer.from(match[2], 'hex')) ? ip : undefined;
}

export function clientIp(request: RequestLike, settings: ClientIpSettings = clientIpSettings()): string {
  if (settings.bffForwardSecret) {
    const now = settings.nowSeconds?.() ?? Math.floor(Date.now() / 1000);
    const forwarded = verifiedForwardedIp(request, settings.bffForwardSecret, now);
    if (forwarded) return forwarded;
  }
  if (settings.trustCloudflareHeaders) {
    const value = single(request.headers?.['cf-connecting-ip']);
    if (value && isIP(value) !== 0) return value;
  }
  return request.ip ?? request.socket?.remoteAddress ?? 'unknown';
}

/**
 * Express's "trust proxy" from TRUST_PROXY: a hop count ("0", the default, trusts no X-Forwarded-For) or a comma-separated list
 * of proxy addresses or CIDR subnets. "true" (trust any sender of X-Forwarded-For) is refused: it would let every client pick its
 * own address.
 */
export function trustProxySetting(raw: string | undefined): number | string[] {
  const value = (raw ?? '').trim();
  if (value === '') return 0;
  if (/^\d+$/.test(value)) return Number(value);
  const entries = value.split(',').map((s) => s.trim());
  const valid = (entry: string) => {
    const parts = entry.split('/');
    const version = isIP(parts[0]);
    if (parts.length > 2 || version === 0) return false;
    if (parts.length === 1) return true;
    return /^\d{1,3}$/.test(parts[1]) && Number(parts[1]) <= (version === 4 ? 32 : 128);
  };
  if (entries.every(valid)) return entries;
  throw new Error(`CONFIGURATION ERROR: TRUST_PROXY=${value} must be a hop count or a list of proxy addresses/subnets, never "true".`);
}
