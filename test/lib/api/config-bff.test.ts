import { afterEach, describe, expect, it, vi } from 'vitest';

const API = 'http://localhost:4000/v1/api';

async function apiBase({ browser }: { browser: boolean }) {
  vi.resetModules();
  vi.stubEnv('NEXT_PUBLIC_API_URL', API);
  if (browser) vi.stubGlobal('window', {});
  const { apiConfig } = await import('@/lib/api/config');
  return apiConfig.endpoints.api.v1;
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe('API base URL', () => {
  it('is the same-origin BFF in the browser', async () => {
    expect(await apiBase({ browser: true })).toBe('/api/v1');
  });

  it('is the API itself on the server, which attaches the token', async () => {
    expect(await apiBase({ browser: false })).toBe(API);
  });
});
