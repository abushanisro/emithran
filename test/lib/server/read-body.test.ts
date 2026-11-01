import { describe, expect, it } from 'vitest';

import { MAX_REQUEST_BODY_BYTES, PROXY_CLIENT_MAX_BODY_BYTES } from '@/lib/server/body-limits';
import { readBodyBytes, readFormDataBody, readJsonBody } from '@/lib/server/read-body';

const post = (body: BodyInit | null, headers: Record<string, string> = {}) =>
  new Request('http://localhost/api/x', { method: 'POST', body, headers, duplex: 'half' } as RequestInit & { duplex: 'half' });

/** A body with no Content-Length that yields `chunks` chunks of `size` bytes, counting how many were pulled. */
function chunked(chunks: number, size: number) {
  const pulled = { count: 0 };
  const stream = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (pulled.count >= chunks) {
        controller.close();
        return;
      }
      pulled.count++;
      controller.enqueue(new Uint8Array(size));
    },
  });
  return { stream, pulled };
}

describe('readBodyBytes', () => {
  it('returns a body within the limit', async () => {
    const result = await readBodyBytes(post('hello'), 5);
    expect(result.ok && new TextDecoder().decode(result.value)).toBe('hello');
  });

  it('refuses a declared Content-Length over the limit without reading', async () => {
    const result = await readBodyBytes(post('x', { 'content-length': '1000' }), 10);
    expect(!result.ok && result.response.status).toBe(413);
  });

  it('stops reading a chunked body as soon as it passes the limit', async () => {
    const { stream, pulled } = chunked(100, 1024);
    const result = await readBodyBytes(post(stream), 4 * 1024);
    expect(!result.ok && result.response.status).toBe(413);
    expect(pulled.count).toBeLessThan(10);
  });

  it('never allows more than the global ceiling, whatever the caller asks', async () => {
    const result = await readBodyBytes(post('x', { 'content-length': String(MAX_REQUEST_BODY_BYTES + 1) }), Number.MAX_SAFE_INTEGER);
    expect(!result.ok && result.response.status).toBe(413);
  });

  it('keeps the proxy body limit above the ceiling, so Next never truncates a body a route accepts', () => {
    expect(PROXY_CLIENT_MAX_BODY_BYTES).toBeGreaterThan(MAX_REQUEST_BODY_BYTES);
  });
});

describe('readJsonBody / readFormDataBody', () => {
  it('parses JSON and refuses non-JSON with 400', async () => {
    const ok = await readJsonBody(post('{"a":1}'), 100);
    expect(ok.ok && ok.value).toEqual({ a: 1 });
    const bad = await readJsonBody(post('{'), 100);
    expect(!bad.ok && bad.response.status).toBe(400);
  });

  it('parses multipart form data within the limit', async () => {
    const form = new FormData();
    form.append('file', new Blob(['abc']), 'a.txt');
    const request = new Request('http://localhost/api/x', { method: 'POST', body: form });
    const result = await readFormDataBody(request, 10_000);
    expect(result.ok && (await (result.value.get('file') as Blob).text())).toBe('abc');
  });
});
