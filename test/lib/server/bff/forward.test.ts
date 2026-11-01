import { describe, expect, it, vi } from 'vitest';

import { forwardRequest, upstreamUrl } from '@/lib/server/bff/forward';

const API = 'http://api.internal:4000/v1/api';

describe('upstreamUrl', () => {
  it('maps the path segments and query onto the API base', () => {
    expect(upstreamUrl(['projects', 'p1', 'boms'], '?page=2&q=a%20b', API)?.href).toBe(
      'http://api.internal:4000/v1/api/projects/p1/boms?page=2&q=a%20b',
    );
  });

  it('re-encodes each segment, so a decoded value stays inside its segment', () => {
    expect(upstreamUrl(['files', 'a b?c#d'], '', API)?.pathname).toBe('/v1/api/files/a%20b%3Fc%23d');
  });

  it.each([
    [['..', 'admin']],
    [['projects', '.']],
    [['projects', '']],
    [['a/b']], // an encoded slash arrives decoded inside one segment
    [['a\\b']],
    [[]],
  ])('refuses %j, which could leave the API path', (path) => {
    expect(upstreamUrl(path, '', API)).toBeNull();
  });
});

function capture(response: Response) {
  const fetcher = vi.fn<typeof fetch>(() => Promise.resolve(response));
  const sent = () => {
    const init = fetcher.mock.calls[0]?.[1] ?? {};
    return { init, headers: new Headers(init.headers) };
  };
  return { fetcher, sent };
}

const browserRequest = (init: { method?: string; body?: string } = {}) =>
  new Request('https://app.example.com/api/v1/projects', {
    ...init,
    headers: {
      cookie: 'appSession=secret',
      authorization: 'Bearer from-the-browser',
      'x-organization-id': 'org-1',
      'x-request-id': 'req-1',
      'x-user-id': 'someone-else',
      'content-type': 'application/json',
    },
  });

describe('forwardRequest', () => {
  const url = new URL(`${API}/projects`);

  it("sends the session's token and only the allow-listed browser headers", async () => {
    const { fetcher, sent } = capture(new Response('{}'));
    await forwardRequest(browserRequest(), url, 'server-token', fetcher);

    const { headers } = sent();
    expect(headers.get('authorization')).toBe('Bearer server-token');
    expect(headers.get('cookie')).toBeNull();
    expect(headers.get('x-user-id')).toBeNull();
    expect(headers.get('x-organization-id')).toBe('org-1');
    expect(headers.get('x-request-id')).toBe('req-1');
    expect(headers.get('content-type')).toBe('application/json');
  });

  it('streams the request body and does not follow redirects', async () => {
    const { fetcher, sent } = capture(new Response('{}'));
    await forwardRequest(browserRequest({ method: 'POST', body: '{"name":"x"}' }), url, 't', fetcher);

    const { init } = sent();
    expect(init.method).toBe('POST');
    expect(init.redirect).toBe('manual');
    expect(await new Response(init.body).text()).toBe('{"name":"x"}');
  });

  it('returns an upstream redirect as it is', async () => {
    const { fetcher } = capture(new Response(null, { status: 302, headers: { location: 'https://elsewhere.example' } }));
    const res = await forwardRequest(browserRequest(), url, 't', fetcher);
    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toBe('https://elsewhere.example');
  });

  it('passes an error status and body through, so the client still sees the idle-timeout code', async () => {
    const body = '{"error":{"code":"SESSION_IDLE_TIMEOUT"}}';
    const { fetcher } = capture(new Response(body, { status: 401 }));
    const res = await forwardRequest(browserRequest(), url, 't', fetcher);
    expect(res.status).toBe(401);
    expect(await res.text()).toBe(body);
  });

  it('streams an event stream without waiting for it to end', async () => {
    let push: (chunk: string) => void = () => undefined;
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        push = (chunk) => {
          controller.enqueue(new TextEncoder().encode(chunk));
        };
      },
    });
    const { fetcher } = capture(new Response(stream, { headers: { 'content-type': 'text/event-stream' } }));
    const res = await forwardRequest(browserRequest(), url, 't', fetcher);

    if (!res.body) throw new Error('expected a streamed body');
    const reader = res.body.getReader();
    push('data: one\n\n');
    expect(new TextDecoder().decode((await reader.read()).value)).toBe('data: one\n\n');
    expect(res.headers.get('content-type')).toBe('text/event-stream');
    await reader.cancel();
  });

  it('drops upstream cookies and encoding headers that no longer match the decoded body', async () => {
    const { fetcher } = capture(
      new Response('{}', { headers: { 'set-cookie': 'a=b', 'content-encoding': 'gzip', 'x-request-id': 'req-1' } }),
    );
    const res = await forwardRequest(browserRequest(), url, 't', fetcher);
    expect(res.headers.get('set-cookie')).toBeNull();
    expect(res.headers.get('content-encoding')).toBeNull();
    expect(res.headers.get('x-request-id')).toBe('req-1');
  });

  it('answers 204 without a body', async () => {
    const { fetcher } = capture(new Response(null, { status: 204 }));
    const res = await forwardRequest(browserRequest({ method: 'DELETE' }), url, 't', fetcher);
    expect(res.status).toBe(204);
  });

  it('refuses a body declared larger than the limit with 413, without calling the API', async () => {
    const { fetcher } = capture(new Response('{}'));
    const req = new Request('https://app.example.com/api/v1/files', { method: 'POST', body: 'x', headers: { 'content-length': '100' } });
    const res = await forwardRequest(req, url, 't', fetcher, 10);
    expect(res.status).toBe(413);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('answers 413 when a chunked body passes the limit while streaming, instead of sending it truncated', async () => {
    // The fetcher reads the body as the API would; the cap errors the stream once it passes the limit.
    const fetcher = vi.fn<typeof fetch>(async (_url, init) => {
      await new Response(init?.body).arrayBuffer();
      return new Response('{}');
    });
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        for (let i = 0; i < 5; i++) controller.enqueue(new Uint8Array(10));
        controller.close();
      },
    });
    const req = new Request('https://app.example.com/api/v1/files', { method: 'POST', body: stream, duplex: 'half' } as RequestInit & { duplex: 'half' });
    const res = await forwardRequest(req, url, 't', fetcher, 25);
    expect(res.status).toBe(413);
  });
});
