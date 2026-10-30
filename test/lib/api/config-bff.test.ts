import { afterEach, describe, expect, it, vi } from 'vitest';

const API = 'http://localhost:4000/v1/api';

async function apiBase({ bff, browser }: { bff: string; browser: boolean }) {
  vi.resetModules();
  vi.stubEnv('NEXT_PUBLIC_BFF', bff);
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
  it('is the same-origin BFF in the browser when the flag is on', async () => {
    expect(await apiBase({ bff: 'on', browser: true })).toBe('/api/v1');
  });

  it('stays the API URL on the server, which calls the API itself', async () => {
    expect(await apiBase({ bff: 'on', browser: false })).toBe(API);
  });

  it('is unchanged while the flag is off', async () => {
    expect(await apiBase({ bff: '', browser: true })).toBe(API);
  });
});
