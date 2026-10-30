import { afterEach, describe, expect, it, vi } from 'vitest';

const sdkGetAccessToken = vi.fn<() => Promise<string>>();
vi.mock('@auth0/nextjs-auth0', () => ({ getAccessToken: () => sdkGetAccessToken() }));
vi.mock('@/lib/supabase/client', () => ({ supabase: null }));

const profile = vi.fn<typeof fetch>();

async function load() {
  vi.resetModules();
  vi.stubEnv('NEXT_PUBLIC_AUTH_BACKEND', 'auth0');
  vi.stubEnv('NEXT_PUBLIC_BFF', 'on');
  vi.stubGlobal('fetch', profile);
  vi.stubGlobal('window', { addEventListener: vi.fn(), removeEventListener: vi.fn() });
  return (await import('@/lib/auth/session-source')).sessionSource;
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe('Auth0 session source behind the BFF', () => {
  it('has no access token to give out', async () => {
    const source = await load();
    expect(await source.getAccessToken()).toBeNull();
    expect(await source.refresh()).toBeNull();
    expect(sdkGetAccessToken).not.toHaveBeenCalled();
  });

  it('tells the idle timer the session id from the profile', async () => {
    profile.mockResolvedValue(Response.json({ sub: 'auth0|1', sid: 'sid-1' }));
    const source = await load();
    const seen = await new Promise<string | null>((resolve) => {
      source.onSessionChange(resolve);
    });
    expect(seen).toBe('sid-1');
    expect(profile).toHaveBeenCalledWith('/auth/profile', expect.objectContaining({ cache: 'no-store' }));
  });

  it('reports no session when the profile answers 401', async () => {
    profile.mockResolvedValue(new Response(null, { status: 401 }));
    const source = await load();
    const seen = await new Promise<string | null>((resolve) => {
      source.onSessionChange(resolve);
    });
    expect(seen).toBeNull();
  });
});
