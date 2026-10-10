/**
 * Server-side download of a caller-supplied storage URL, safe against SSRF and
 * resource abuse: the host must be the project's own storage (plus any hosts
 * named in TRUSTED_STORAGE_HOSTS), redirects are followed by hand and re-checked,
 * and size and time are capped. Pure checks are exported for tests.
 */

function configuredHosts(): string[] {
  const hosts: string[] = [];
  try {
    if (process.env.NEXT_PUBLIC_SUPABASE_URL) hosts.push(new URL(process.env.NEXT_PUBLIC_SUPABASE_URL).hostname);
  } catch { /* unset or malformed: no project host */ }
  for (const h of (process.env.TRUSTED_STORAGE_HOSTS ?? '').split(',')) if (h.trim()) hosts.push(h.trim().toLowerCase());
  return hosts;
}

const IPV4 = /^\d{1,3}(\.\d{1,3}){3}$/;

export function isTrustedStorageUrl(raw: string, hosts: readonly string[] = configuredHosts()): boolean {
  let url: URL;
  try { url = new URL(raw); } catch { return false; }
  if (url.username || url.password) return false;
  const host = url.hostname.toLowerCase();
  const trusted = hosts.some((h) => host === h || host.endsWith(`.${h}`));
  if (!trusted) return false;
  // https everywhere; plain http only for the project's own host (local Supabase).
  if (url.protocol === 'https:') return true;
  return url.protocol === 'http:' && (IPV4.test(host) || host === 'localhost') && hosts.includes(host);
}

export class UntrustedUrlError extends Error {}
export class PayloadTooLargeError extends Error {}

export async function fetchTrustedFile(
  rawUrl: string,
  opts: { timeoutMs?: number; maxRedirects?: number; headers?: Record<string, string> } = {},
): Promise<Response> {
  const { timeoutMs = 30_000, maxRedirects = 3, headers } = opts;
  let url = rawUrl;
  for (let hop = 0; hop <= maxRedirects; hop++) {
    if (!isTrustedStorageUrl(url)) throw new UntrustedUrlError('URL is not on the trusted storage host');
    const res = await fetch(url, { redirect: 'manual', signal: AbortSignal.timeout(timeoutMs), ...(headers ? { headers } : {}) });
    if (res.status >= 300 && res.status < 400) {
      const location = res.headers.get('location');
      if (!location) throw new UntrustedUrlError('Redirect without a location');
      url = new URL(location, url).toString();
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
