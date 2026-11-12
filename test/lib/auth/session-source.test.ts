import { afterEach, describe, expect, it, vi } from 'vitest';

const profile = vi.fn<typeof fetch>();

const assign = vi.fn();

async function load() {
  vi.resetModules();
  vi.stubGlobal('fetch', profile);
  vi.stubGlobal('window', { addEventListener: vi.fn(), removeEventListener: vi.fn(), location: { assign } });
  return (await import('@/lib/auth/session-source')).sessionSource;
}

const firstSessionId = (source: Awaited<ReturnType<typeof load>>) =>
  new Promise<string | null>((resolve) => {
    source.onSessionChange(resolve);
  });

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe('browser session source', () => {
  it('offers no way to read an access token', async () => {
    const source = await load();
    expect(Object.keys(source).sort()).toEqual(['onSessionChange', 'signOutThisDevice']);
  });

  it('tells the idle timer the session id from the Auth0 profile', async () => {
    profile.mockResolvedValue(Response.json({ sub: 'auth0|1', sid: 'sid-1' }));
    expect(await firstSessionId(await load())).toBe('sid-1');
    expect(profile).toHaveBeenCalledWith('/auth/profile', expect.objectContaining({ cache: 'no-store' }));
  });

  it('reports no session when the profile answers 401', async () => {
    profile.mockResolvedValue(new Response(null, { status: 401 }));
    expect(await firstSessionId(await load())).toBeNull();
  });

  // Logout ends the session on the server first (a copied cookie is then refused), then leaves through Auth0's logout.
  it('ends the session on the server, then leaves through Auth0 logout', async () => {
    profile.mockResolvedValue(new Response(null, { status: 204 }));
    const source = await load();
    void source.signOutThisDevice();
    await vi.waitFor(() => { expect(assign).toHaveBeenCalledWith('/auth/logout'); });
    expect(profile).toHaveBeenCalledWith('/api/v1/auth/session/end', expect.objectContaining({ method: 'POST' }));
    expect(profile.mock.invocationCallOrder[0]).toBeLessThan(assign.mock.invocationCallOrder[0] ?? 0);
  });

  it('still logs out when the server cannot be reached', async () => {
    profile.mockRejectedValue(new TypeError('network down'));
    const source = await load();
    void source.signOutThisDevice();
    await vi.waitFor(() => { expect(assign).toHaveBeenCalledWith('/auth/logout'); });
  });
});
