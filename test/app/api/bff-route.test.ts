import { NextRequest } from 'next/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const sessionAccessToken = vi.fn<() => Promise<string | null>>();
vi.mock('@/lib/server/auth', () => ({ sessionAccessToken: () => sessionAccessToken() }));

const { GET, POST } = await import('@/app/api/v1/[...path]/route');

const APP = 'https://app.example.com';
const upstream = vi.fn<typeof fetch>();
const upstreamCall = () => {
  const call = upstream.mock.calls[0];
  if (!call) throw new Error('the API was not called');
  const [url, init] = call;
  return { url: url instanceof URL ? url.href : url, init: init ?? {} };
};

const call = (handler: typeof GET, path: string[], init: { method?: string; headers?: Record<string, string>; body?: string } = {}) =>
  handler(new NextRequest(`${APP}/api/v1/${path.join('/')}`, init), { params: Promise.resolve({ path }) });

beforeEach(() => {
  vi.stubEnv('NEXT_PUBLIC_APP_URL', APP);
  vi.stubEnv('API_URL', 'http://api.internal:4000/v1/api');
  vi.stubGlobal('fetch', upstream);
  sessionAccessToken.mockResolvedValue('server-token');
  upstream.mockReset().mockResolvedValue(new Response('{"data":[]}', { headers: { 'content-type': 'application/json' } }));
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe('/api/v1/[...path]', () => {
  it('forwards a signed-in GET to the API with the server-side token', async () => {
    const res = await call(GET, ['projects']);

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ data: [] });
    const { url, init } = upstreamCall();
    expect(url).toBe('http://api.internal:4000/v1/api/projects');
    expect(new Headers(init.headers).get('authorization')).toBe('Bearer server-token');
  });

  it('answers 401 without calling the API when there is no session', async () => {
    sessionAccessToken.mockResolvedValue(null);
    const res = await call(GET, ['projects']);
    expect(res.status).toBe(401);
    expect(upstream).not.toHaveBeenCalled();
  });

  it('refuses a POST from another origin, or with none, before reading the session', async () => {
    expect((await call(POST, ['projects'], { method: 'POST', headers: { origin: 'https://evil.example' } })).status).toBe(403);
    expect((await call(POST, ['projects'], { method: 'POST' })).status).toBe(403);
    expect(sessionAccessToken).not.toHaveBeenCalled();
    expect(upstream).not.toHaveBeenCalled();
  });

  it('forwards a POST from the app origin', async () => {
    const res = await call(POST, ['projects'], { method: 'POST', headers: { origin: APP }, body: '{"name":"x"}' });
    expect(res.status).toBe(200);
    expect(upstreamCall().init.method).toBe('POST');
  });

  it('answers 400 for a path that could leave the API', async () => {
    expect((await call(GET, ['..', 'admin'])).status).toBe(400);
    expect(upstream).not.toHaveBeenCalled();
  });

  it('answers 502 when the API cannot be reached', async () => {
    upstream.mockRejectedValue(new TypeError('fetch failed'));
    expect((await call(GET, ['projects'])).status).toBe(502);
  });
});
