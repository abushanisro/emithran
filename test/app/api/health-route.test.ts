import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const upstream = vi.fn<typeof fetch>();

// The route remembers the last answer, so each test loads a fresh copy of it.
const load = async () => {
  vi.resetModules();
  return import('@/app/api/health/route');
};

beforeEach(() => {
  vi.stubEnv('API_URL', 'http://api.internal:4000/api/v1');
  vi.stubGlobal('fetch', upstream);
  upstream.mockReset();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe('GET /api/health', () => {
  it('answers 200 when the API is alive, asking its liveness endpoint on the internal origin', async () => {
    upstream.mockResolvedValue(new Response('{"status":"ok"}'));
    const { GET } = await load();

    const res = await GET();

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: 'ok' });
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(upstream.mock.calls[0]?.[0]).toBe('http://api.internal:4000/api/health/live');
  });

  it('answers 503 when the API does not answer or reports unhealthy', async () => {
    upstream.mockRejectedValue(new Error('connect ECONNREFUSED'));
    expect((await (await load()).GET()).status).toBe(503);

    upstream.mockResolvedValue(new Response('down', { status: 503 }));
    expect((await (await load()).GET()).status).toBe(503);
  });

  it('answers 503 when no API address is configured', async () => {
    vi.stubEnv('API_URL', '');
    vi.stubEnv('NEXT_PUBLIC_API_URL', '');
    expect((await (await load()).GET()).status).toBe(503);
    expect(upstream).not.toHaveBeenCalled();
  });

  it('asks the API once for many callers inside the remember window, and again after it', async () => {
    vi.useFakeTimers();
    upstream.mockResolvedValue(new Response('{}'));
    const { GET } = await load();

    await Promise.all([GET(), GET(), GET()]);
    await GET();
    expect(upstream).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(5_001);
    await GET();
    expect(upstream).toHaveBeenCalledTimes(2);
  });

  it('exposes nothing but the status word', async () => {
    upstream.mockResolvedValue(new Response('{"version":"1.2.3","db":"postgres://secret"}'));
    const body = (await (await (await load()).GET()).json()) as Record<string, unknown>;
    expect(Object.keys(body)).toEqual(['status']);
  });
});
