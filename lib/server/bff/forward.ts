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
export async function forwardRequest(req: Request, url: URL, token: string, fetcher: typeof fetch = fetch): Promise<Response> {
  const headers = new Headers({ authorization: `Bearer ${token}` });
  for (const name of FORWARDED_REQUEST_HEADERS) {
    const value = req.headers.get(name);
    if (value !== null) headers.set(name, value);
  }

  const hasBody = req.method !== 'GET' && req.method !== 'HEAD';
  // duplex is required by Node's fetch to stream a request body (uploads are not buffered); the DOM typings do not declare it yet.
  const init: RequestInit & { duplex?: 'half' } = {
    method: req.method,
    headers,
    ...(hasBody && { body: req.body, duplex: 'half' }),
    // A redirect from the API goes back to the browser instead of being followed with the token attached.
    redirect: 'manual',
    signal: req.signal,
    cache: 'no-store',
  };
  const upstream = await fetcher(url, init);

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
