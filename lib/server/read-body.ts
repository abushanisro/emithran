import { NextResponse } from 'next/server';

import { MAX_REQUEST_BODY_BYTES } from '@/lib/server/body-limits';

/**
 * Size-capped request body reading for route handlers. request.json(), formData() and arrayBuffer() buffer the whole body with no
 * limit, and requests that skip proxy.ts (prefetch headers) are not bounded by Next's proxy body copy either. Every handler that reads
 * a body goes through here: a declared Content-Length over the cap is refused before reading, and the stream is cut off as soon as it
 * passes the cap (chunked bodies declare no length), both with 413.
 */

export type BodyResult<T> = { ok: true; value: T } | { ok: false; response: NextResponse };

const tooLarge = (maxBytes: number): BodyResult<never> => ({
  ok: false,
  response: NextResponse.json({ error: 'Request body too large', maxBytes }, { status: 413 }),
});
const invalid = (error: string): BodyResult<never> => ({ ok: false, response: NextResponse.json({ error }, { status: 400 }) });

/** The raw body, at most `maxBytes` (never more than MAX_REQUEST_BODY_BYTES). */
export async function readBodyBytes(req: Request, maxBytes: number): Promise<BodyResult<Uint8Array<ArrayBuffer>>> {
  const limit = Math.min(maxBytes, MAX_REQUEST_BODY_BYTES);
  const declared = req.headers.get('content-length');
  if (declared !== null && (!/^\d+$/.test(declared) || Number(declared) > limit)) return tooLarge(limit);
  if (!req.body) return { ok: true, value: new Uint8Array(new ArrayBuffer(0)) };

  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > limit) {
      await reader.cancel().catch(() => undefined);
      return tooLarge(limit);
    }
    chunks.push(value);
  }
  const body = new Uint8Array(new ArrayBuffer(total));
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return { ok: true, value: body };
}

/** The body parsed as JSON, at most `maxBytes`; 400 when it is not JSON. */
export async function readJsonBody<T = unknown>(req: Request, maxBytes: number): Promise<BodyResult<T>> {
  const bytes = await readBodyBytes(req, maxBytes);
  if (!bytes.ok) return bytes;
  try {
    return { ok: true, value: JSON.parse(new TextDecoder().decode(bytes.value)) as T };
  } catch {
    return invalid('Request body must be JSON');
  }
}

/** The body parsed as multipart or urlencoded form data, at most `maxBytes`; 400 when it is not a form. */
export async function readFormDataBody(req: Request, maxBytes: number): Promise<BodyResult<FormData>> {
  const bytes = await readBodyBytes(req, maxBytes);
  if (!bytes.ok) return bytes;
  try {
    const form = await new Response(bytes.value, {
      headers: { 'content-type': req.headers.get('content-type') ?? '' },
    }).formData();
    return { ok: true, value: form };
  } catch {
    return invalid('Request body must be form data');
  }
}
