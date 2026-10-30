import { afterEach, describe, expect, it, vi } from 'vitest';

const getAccessToken = vi.fn<() => Promise<string | null>>();
vi.mock('@/lib/auth/session-source', () => ({ sessionSource: { getAccessToken: () => getAccessToken() } }));

async function load(bff: string) {
  vi.resetModules();
  vi.stubEnv('NEXT_PUBLIC_BFF', bff);
  return (await import('@/lib/api/auth-headers')).browserAuthHeaders;
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});

describe('browserAuthHeaders', () => {
  it('sends no token through the BFF and never asks for one', async () => {
    const browserAuthHeaders = await load('on');
    expect(await browserAuthHeaders()).toEqual({});
    expect(getAccessToken).not.toHaveBeenCalled();
  });

  it('sends the session token straight to the API while the BFF is off', async () => {
    getAccessToken.mockResolvedValue('t');
    expect(await (await load(''))()).toEqual({ Authorization: 'Bearer t' });
  });

  it('is null without a session, never "Bearer null"', async () => {
    getAccessToken.mockResolvedValue(null);
    expect(await (await load(''))()).toBeNull();
  });
});
