import { afterEach, describe, expect, it, vi } from 'vitest';

const profile = vi.fn<typeof fetch>();

async function load() {
  vi.resetModules();
  vi.stubGlobal('fetch', profile);
  vi.stubGlobal('window', { addEventListener: vi.fn(), removeEventListener: vi.fn() });
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
});
