import { afterEach, describe, expect, it, vi } from 'vitest';

const auth0GetAccessToken = vi.fn<() => Promise<{ token: string }>>();
const supabaseGetSession = vi.fn<() => Promise<{ data: { session: { access_token: string } | null } }>>();

vi.mock('@/lib/auth0', () => ({ getAuth0: () => ({ getAccessToken: auth0GetAccessToken }) }));
vi.mock('@/lib/supabase/server', () => ({
  createServerSupabaseClient: () => Promise.resolve({ auth: { getSession: supabaseGetSession } }),
}));

async function load(backend: 'auth0' | 'supabase') {
  vi.resetModules();
  vi.stubEnv('NEXT_PUBLIC_AUTH_BACKEND', backend);
  return (await import('@/lib/server/auth')).sessionAccessToken;
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});

describe('sessionAccessToken', () => {
  it("returns the Auth0 session's API token", async () => {
    auth0GetAccessToken.mockResolvedValue({ token: 'auth0-token' });
    expect(await (await load('auth0'))()).toBe('auth0-token');
  });

  it('is null when Auth0 has no session or cannot refresh it', async () => {
    auth0GetAccessToken.mockRejectedValue(new Error('no session'));
    expect(await (await load('auth0'))()).toBeNull();
  });

  it("returns the Supabase session's token, and null without one", async () => {
    const sessionAccessToken = await load('supabase');
    supabaseGetSession.mockResolvedValueOnce({ data: { session: { access_token: 'sb-token' } } });
    expect(await sessionAccessToken()).toBe('sb-token');
    supabaseGetSession.mockResolvedValueOnce({ data: { session: null } });
    expect(await sessionAccessToken()).toBeNull();
  });
});
