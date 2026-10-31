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

export function isTrustedStorageUrl(
  raw: string,
  hosts: readonly string[] = configuredHosts(),
  nodeEnv: string | undefined = process.env.NODE_ENV,
): boolean {
  let url: URL;
  try { url = new URL(raw); } catch { return false; }
  if (url.username || url.password) return false;
  // url.host is hostname[:port], with the scheme's default port dropped.
  const host = url.host.toLowerCase();
  if (!hosts.includes(host)) return false;
  if (url.protocol === 'https:') return true;
  return url.protocol === 'http:'
    && nodeEnv !== 'production'
    && (IPV4.test(url.hostname) || url.hostname === 'localhost');
}

export class UntrustedUrlError extends Error {}
export class PayloadTooLargeError extends Error {}

export async function fetchTrustedFile(
  rawUrl: string,
  opts: { timeoutMs?: number; maxRedirects?: number; headers?: Record<string, string> } = {},
): Promise<Response> {
  const { timeoutMs = 30_000, maxRedirects = 3, headers } = opts;
  if (!isTrustedStorageUrl(rawUrl)) throw new UntrustedUrlError('URL is not on the trusted storage host');
  const origin = new URL(rawUrl).origin;
  let url = rawUrl;
  for (let hop = 0; hop <= maxRedirects; hop++) {
    const res = await fetch(url, { redirect: 'manual', signal: AbortSignal.timeout(timeoutMs), ...(headers ? { headers } : {}) });
    if (res.status >= 300 && res.status < 400) {
      const location = res.headers.get('location');
      if (!location) throw new UntrustedUrlError('Redirect without a location');
      const next = new URL(location, url);
      // Same origin only: a storage host must not send us to another host,
      // even another trusted one.
      if (next.origin !== origin || !isTrustedStorageUrl(next.toString())) {
        throw new UntrustedUrlError('Redirect leaves the storage host');
      }
      url = next.toString();
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
