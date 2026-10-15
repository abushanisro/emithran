import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { checkSessionActive, clearSessionChecks } from '@/lib/server/session-idle-check';

const respond = (status: number, body: unknown) =>
  vi.fn(() => Promise.resolve(new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })));

describe('checkSessionActive (Next.js API routes)', () => {
  beforeEach(clearSessionChecks);
  afterEach(() => vi.unstubAllGlobals());

  it('asks the backend with the caller\'s token and accepts an active session', async () => {
    const fetchMock = respond(200, { success: true, data: { enforced: true } });
    vi.stubGlobal('fetch', fetchMock);
    await expect(checkSessionActive('tok')).resolves.toBe('active');
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toMatch(/\/auth\/session$/);
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer tok');
  });

  it('reports a session the backend ended for inactivity', async () => {
    vi.stubGlobal('fetch', respond(401, { success: false, error: { code: 'SESSION_IDLE_TIMEOUT' } }));
    await expect(checkSessionActive('tok')).resolves.toBe('idle');
  });

  it('reports any other 401 as invalid', async () => {
    vi.stubGlobal('fetch', respond(401, { success: false, error: { code: 'UNAUTHORIZED' } }));
    await expect(checkSessionActive('tok')).resolves.toBe('invalid');
  });

  it('fails closed as unavailable when the backend cannot answer', async () => {
    vi.stubGlobal('fetch', respond(503, {}));
    await expect(checkSessionActive('tok')).resolves.toBe('unavailable');
    vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new TypeError('fetch failed'))));
    await expect(checkSessionActive('tok')).resolves.toBe('unavailable');
  });

  it('reuses an active answer for up to 30 seconds instead of asking the backend on every call', async () => {
    const fetchMock = respond(200, { success: true, data: { deadline: 10 * 60_000 } });
    vi.stubGlobal('fetch', fetchMock);
    await checkSessionActive('tok', 0);
    await expect(checkSessionActive('tok', 29_999)).resolves.toBe('active');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await checkSessionActive('tok', 30_000);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('never reuses an active answer past the session deadline the backend reported', async () => {
    const fetchMock = respond(200, { success: true, data: { deadline: 5_000 } });
    vi.stubGlobal('fetch', fetchMock);
    await checkSessionActive('tok', 0);
    await checkSessionActive('tok', 5_000);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('never reuses an idle, invalid or unavailable answer', async () => {
    const fetchMock = respond(401, { success: false, error: { code: 'SESSION_IDLE_TIMEOUT' } });
    vi.stubGlobal('fetch', fetchMock);
    await checkSessionActive('tok', 0);
    await checkSessionActive('tok', 1);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
