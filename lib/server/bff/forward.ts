import { createHmac } from 'node:crypto';
import { isIP } from 'node:net';

import { MAX_REQUEST_BODY_BYTES } from '@/lib/server/body-limits';

/**
 * The browser's address, passed on to the API so its pre-auth rate limit and audit trail see the person, not this container.
 * Cloudflare sets CF-Connecting-IP and overwrites any value a client sent; the frontend is reachable only through the tunnel, so the
 * header is the client's. It is sent as X-Emithran-Client-Ip with a fresh HMAC-SHA256 signature of "<unix seconds>.<address>" made
 * with BFF_FORWARD_SECRET, the secret the API shares; the API honours the address only when that signature verifies
 * (backend/src/common/client-ip.ts). Without a secret, or without a valid address, nothing is sent and the API counts this container.
 */
export function clientAddressHeaders(req: Request, secret: string | undefined, nowSeconds: number): Record<string, string> {
  const ip = req.headers.get('cf-connecting-ip')?.trim();
  if (!secret || !ip || isIP(ip) === 0) return {};
  const signature = createHmac('sha256', secret).update(`${nowSeconds}.${ip}`).digest('hex');
  return { 'x-emithran-client-ip': ip, 'x-emithran-client-ip-signature': `${nowSeconds}.${signature}` };
}

/** In production the BFF must forward the client address; a missing or short secret is a deployment error (the route refuses). */
export function forwardSecretProblem(env: Record<string, string | undefined> = process.env): string | null {
  if (env.NODE_ENV !== 'production') return null;
  const secret = env.BFF_FORWARD_SECRET;
  return secret && secret.length >= 32 ? null : 'BFF_FORWARD_SECRET must be set (at least 32 characters, the same value as the API)';
}

/**
 * Browser headers the API may see. An allow-list, so cookies, the browser's own Authorization and any identity-looking header never
 * reach the API; the API learns who is calling only from the token the BFF attaches.
 */
const FORWARDED_REQUEST_HEADERS = [
  'accept',
  'accept-language',
  'content-type',
  'idempotency-key',
  'if-match',
  'if-none-match',
  'last-event-id',
  'range',
  'traceparent',
  'tracestate',
  'x-organization-id',
  'x-request-id',
];

/**
 * Response headers that must not be copied: hop-by-hop headers, the API's cookies (the browser's cookies belong to the app), and the
 * encoding and length of a body that fetch has already decoded.
 */
const DROPPED_RESPONSE_HEADERS = new Set([
  'connection',
  'content-encoding',
  'content-length',
  'keep-alive',
  'set-cookie',
  'transfer-encoding',
]);

const NULL_BODY_STATUSES = new Set([101, 204, 205, 304]);

const bodyTooLarge = () =>
  Response.json({ success: false, error: { code: 'PAYLOAD_TOO_LARGE', message: 'Request body too large' } }, { status: 413 });

/**
 * The API URL for a BFF path, or null when a segment could step outside the API base. Next.js hands over decoded segments, so an
 * encoded slash or dot-segment shows up here as "a/b" or "..".
 */
export function upstreamUrl(path: readonly string[], search: string, apiBase: string): URL | null {
  const unsafe = (segment: string) => segment === '' || segment === '.' || segment === '..' || /[/\\]/.test(segment);
  if (path.length === 0 || path.some(unsafe)) return null;
  const base = apiBase.replace(/\/+$/, '');
  return new URL(`${base}/${path.map(encodeURIComponent).join('/')}${search}`);
}

/** Sends the browser's request to the API with the session's token and streams the answer back unchanged. */
export async function forwardRequest(
  req: Request,
  url: URL,
  token: string,
  fetcher: typeof fetch = fetch,
  maxBodyBytes: number = MAX_REQUEST_BODY_BYTES,
  forwardSecret: string | undefined = process.env.BFF_FORWARD_SECRET,
): Promise<Response> {
  const headers = new Headers({
    authorization: `Bearer ${token}`,
    ...clientAddressHeaders(req, forwardSecret, Math.floor(Date.now() / 1000)),
  });
  for (const name of FORWARDED_REQUEST_HEADERS) {
    const value = req.headers.get(name);
    if (value !== null) headers.set(name, value);
  }

  const hasBody = req.method !== 'GET' && req.method !== 'HEAD';
  // Bodies are capped below Next's proxy body limit (lib/server/body-limits), so an oversized upload is refused, never truncated.
  const declared = req.headers.get('content-length');
  if (hasBody && declared !== null && !(/^\d+$/.test(declared) && Number(declared) <= maxBodyBytes)) return bodyTooLarge();
  let received = 0;
  const cap = { exceeded: false };
  const body = hasBody && req.body
    ? req.body.pipeThrough(new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, controller) {
        received += chunk.byteLength;
        if (received > maxBodyBytes) {
          cap.exceeded = true;
          controller.error(new Error('Request body too large'));
          return;
        }
        controller.enqueue(chunk);
      },
    }))
    : null;
  // duplex is required by Node's fetch to stream a request body (uploads are not buffered); the DOM typings do not declare it yet.
  const init: RequestInit & { duplex?: 'half' } = {
    method: req.method,
    headers,
    ...(body && { body, duplex: 'half' }),
    // A redirect from the API goes back to the browser instead of being followed with the token attached.
    redirect: 'manual',
    signal: req.signal,
    cache: 'no-store',
  };
  let upstream: Response;
  try {
    upstream = await fetcher(url, init);
  } catch (error) {
    if (cap.exceeded) return bodyTooLarge();
    throw error;
  }

  const responseHeaders = new Headers();
  upstream.headers.forEach((value, name) => {
    if (!DROPPED_RESPONSE_HEADERS.has(name)) responseHeaders.set(name, value);
  });
  return new Response(NULL_BODY_STATUSES.has(upstream.status) ? null : upstream.body, {
    status: upstream.status,
    statusText: upstream.statusText,
    headers: responseHeaders,
  });
}
