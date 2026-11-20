import { describe, expect, it, vi } from 'vitest';

import { reportNewSignIn } from '@/lib/server/new-sign-in';

const respond = (status: number): typeof fetch => vi.fn(() => Promise.resolve(new Response(null, { status })));

describe('reportNewSignIn', () => {
  it('posts the ID token to the API with the new access token, server to server', async () => {
    const fetcher = vi.fn(() => Promise.resolve(new Response(null, { status: 204 })));
    await expect(reportNewSignIn('access', 'id', fetcher)).resolves.toBe(true);
    const [url, init] = fetcher.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toMatch(/\/auth\/sign-ins$/);
    expect(init.method).toBe('POST');
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer access');
    expect(JSON.parse(init.body as string)).toEqual({ idToken: 'id' });
  });

  it('never blocks the sign-in: no tokens, a refusal or an unreachable API is reported as false', async () => {
    const quiet = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    expect(await reportNewSignIn(undefined, 'id')).toBe(false);
    expect(await reportNewSignIn('a', 'i', respond(401))).toBe(false);
    expect(await reportNewSignIn('a', 'i', vi.fn(() => Promise.reject(new Error('ECONNREFUSED'))))).toBe(false);
    quiet.mockRestore();
  });
});
