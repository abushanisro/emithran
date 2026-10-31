import { afterEach, describe, expect, it, vi } from 'vitest';

const auth0GetAccessToken = vi.fn<() => Promise<{ token: string }>>();
vi.mock('@/lib/auth0', () => ({ getAuth0: () => ({ getAccessToken: auth0GetAccessToken }) }));

const { sessionAccessToken } = await import('@/lib/server/auth');

afterEach(() => {
  vi.clearAllMocks();
});

describe('sessionAccessToken', () => {
  it("returns the Auth0 session's API token", async () => {
    auth0GetAccessToken.mockResolvedValue({ token: 'auth0-token' });
    expect(await sessionAccessToken()).toBe('auth0-token');
  });

  it('is null when there is no session or it cannot be refreshed', async () => {
    auth0GetAccessToken.mockRejectedValue(new Error('no session'));
    expect(await sessionAccessToken()).toBeNull();
  });
});
