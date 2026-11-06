/**
 * Server-side download of a caller-supplied storage URL, safe against SSRF and
 * resource abuse. The URL is attacker-influenced (the file proxy and the PDF
 * routes take it from the request), so:
 * - its host must be exactly one of the file store's hosts named in
 *   TRUSTED_STORAGE_HOSTS (no subdomain wildcard: on a shared provider host a
 *   wildcard would accept any other customer's bucket); an entry without a
 *   port allows only the scheme's default port, `host:port` allows that port;
 * - it must be https; plain http is accepted only outside production, for a
 *   configured local file store (localhost or an IPv4 address);
 * - credentials in the URL are refused;
 * - redirects are followed by hand and only within the same origin;
 * - size and time are capped.
 * Pure checks are exported for tests.
 */

function configuredHosts(): string[] {
  const hosts: string[] = [];
  for (const h of (process.env.TRUSTED_STORAGE_HOSTS ?? '').split(',')) if (h.trim()) hosts.push(h.trim().toLowerCase());
  return hosts;
}

const IPV4 = /^\d{1,3}(\.\d{1,3}){3}$/;

const MAX_PATH_CHARS = 2048;
const MAX_QUERY_CHARS = 4096;
/** An encoded slash or backslash, or an encoded control character: the path would mean something to the file store that it does not mean to us. */
const UNSAFE_PATH_ESCAPE = /%(2f|5c|[01][0-9a-f]|7f)/i;

/**
 * Whether a request path is plain object-path text on the storage host: a bounded length, no encoded separators or control characters, and no dot
 * segment (decoded: `%2e%2e` is `..`). The URL parser already collapses literal dot segments; this refuses what survives it.
 */
export function isSafeStoragePath(pathname: string): boolean {
  if (!pathname.startsWith('/') || pathname.length > MAX_PATH_CHARS || UNSAFE_PATH_ESCAPE.test(pathname)) return false;
  return pathname.split('/').every((segment) => {
    let decoded: string;
    try { decoded = decodeURIComponent(segment); } catch { return false; }
    return decoded !== '.' && decoded !== '..';
  });
}

/**
 * The URL to fetch, or null when `raw` is not on a trusted storage host. The scheme and the host of the result come only from the server: the scheme
 * is a literal chosen by comparison, the host is the configured entry. The request contributes a path and a query, and only after they pass
 * isSafeStoragePath and a length cap; they are set on a URL whose origin is already fixed, never concatenated into the front of it.
 */
export function trustedStorageUrl(
  raw: string,
  hosts: readonly string[] = configuredHosts(),
  nodeEnv: string | undefined = process.env.NODE_ENV,
): string | null {
  let url: URL;
  try { url = new URL(raw); } catch { return null; }
  if (url.username || url.password) return null;
  // url.host is hostname[:port], with the scheme's default port dropped.
  const trusted = hosts.find((h) => h === url.host.toLowerCase());
  if (!trusted) return null;
  const local = nodeEnv !== 'production' && (IPV4.test(url.hostname) || url.hostname === 'localhost');
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && local)) return null;
  if (!isSafeStoragePath(url.pathname) || url.search.length > MAX_QUERY_CHARS) return null;
  const target = new URL(`${url.protocol === 'http:' ? 'http' : 'https'}://${trusted}`);
  target.pathname = url.pathname;
  target.search = url.search;
  return target.href;
}

export function isTrustedStorageUrl(
  raw: string,
  hosts: readonly string[] = configuredHosts(),
  nodeEnv: string | undefined = process.env.NODE_ENV,
): boolean {
  return trustedStorageUrl(raw, hosts, nodeEnv) !== null;
}

export class UntrustedUrlError extends Error {}
export class PayloadTooLargeError extends Error {}

export async function fetchTrustedFile(
  rawUrl: string,
  opts: { timeoutMs?: number; maxRedirects?: number; headers?: Record<string, string> } = {},
): Promise<Response> {
  const { timeoutMs = 30_000, maxRedirects = 3, headers } = opts;
  const first = trustedStorageUrl(rawUrl);
  if (!first) throw new UntrustedUrlError('URL is not on the trusted storage host');
  const origin = new URL(first).origin;
  let url = first;
  for (let hop = 0; hop <= maxRedirects; hop++) {
    const res = await fetch(url, { redirect: 'manual', signal: AbortSignal.timeout(timeoutMs), ...(headers ? { headers } : {}) });
    if (res.status >= 300 && res.status < 400) {
      const location = res.headers.get('location');
      if (!location) throw new UntrustedUrlError('Redirect without a location');
      // Same origin only: a storage host must not send us to another host, even another trusted one.
      const next = trustedStorageUrl(new URL(location, url).toString());
      if (!next || new URL(next).origin !== origin) throw new UntrustedUrlError('Redirect leaves the storage host');
      url = next;
      continue;
    }
    return res;
  }
  throw new UntrustedUrlError('Too many redirects');
}

/** Read a body fully, failing as soon as it exceeds `maxBytes`. */
export async function readLimited(res: Response, maxBytes: number): Promise<Buffer> {
  const declared = Number(res.headers.get('content-length') ?? 0);
  if (declared > maxBytes) throw new PayloadTooLargeError(`File is larger than ${maxBytes} bytes`);
  if (!res.body) return Buffer.alloc(0);
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) { await reader.cancel(); throw new PayloadTooLargeError(`File is larger than ${maxBytes} bytes`); }
    chunks.push(value);
  }
  return Buffer.concat(chunks);
}

/** A stream that errors once more than `maxBytes` have passed through it. */
export function limitStream(body: ReadableStream<Uint8Array>, maxBytes: number): ReadableStream<Uint8Array> {
  let total = 0;
  return body.pipeThrough(new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, controller) {
      total += chunk.byteLength;
      if (total > maxBytes) { controller.error(new PayloadTooLargeError('File exceeds the size limit')); return; }
      controller.enqueue(chunk);
    },
  }));
}

/** Content types the file proxy may serve; anything renderable as a page (HTML, SVG, XML, JS) is refused. */
const SERVABLE = /^(application\/pdf|application\/octet-stream|application\/step|application\/sla|application\/vnd\.ms-pki\.stl|text\/plain|model\/[\w.+-]+|image\/(png|jpe?g|gif|webp))(;|$)/i;
export function isServableContentType(contentType: string | null): boolean {
  return !!contentType && SERVABLE.test(contentType.trim());
}
