import { NextRequest } from 'next/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { GET } from '@/app/api/file-proxy/route';

// The route requires a signed-in user (lib/server/auth); these tests are about
// the destination boundary, so the caller is signed in.
vi.mock('@/lib/server/auth', () => ({
  requireUser: () => Promise.resolve({ ok: true, userId: 'user-1', accessToken: 'session-token' }),
}));

const fetchMock = vi.fn<typeof fetch>();
const storageUrl = 'https://files.example.com/storage/v1/object/sign/drawings/part.pdf';
const ITEM_ID = '0b5e8a3c-6f1d-4c2a-9e7b-1a2b3c4d5e6f';
const request = (params: Record<string, string>) =>
  new NextRequest(`http://localhost/api/file-proxy?${new URLSearchParams(params)}`);

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
  // The file store's host (lib/server/safe-fetch reads TRUSTED_STORAGE_HOSTS per call).
  vi.stubEnv('TRUSTED_STORAGE_HOSTS', 'files.example.com');
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe('file proxy destination boundary', () => {
  it.each([
    'https://untrusted.example/part.pdf',
    'https://supabase.co.untrusted.example/part.pdf',
    'http://files.example.com/part.pdf',
    'ftp://files.example.com/part.pdf',
    'https://user@files.example.com/part.pdf',
  ])('rejects an unsafe direct URL without fetching: %s', async (url) => {
    const response = await GET(request({ url }));
    expect(response.status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('preserves signed URL encoding and streams the file', async () => {
    const url = `${storageUrl}?filename=bracket%252Fleft%20side.pdf`;
    fetchMock.mockResolvedValue(new Response('pdf-bytes', {
      headers: { 'Content-Type': 'application/pdf', 'Content-Length': '9' },
    }));
    const response = await GET(request({ url }));
    expect(fetchMock).toHaveBeenCalledWith(url, expect.objectContaining({ redirect: 'manual' }));
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('application/pdf');
    expect(response.headers.get('content-length')).toBe('9');
    expect(response.headers.get('x-frame-options')).toBe('SAMEORIGIN');
    expect(await response.text()).toBe('pdf-bytes');
  });

  it.each([301, 302, 303, 307, 308])('does not follow a storage redirect (%s)', async (status) => {
    fetchMock.mockResolvedValue(new Response(null, {
      status, headers: { Location: 'http://127.0.0.1/private' },
    }));
    const response = await GET(request({ url: storageUrl }));
    expect(fetchMock).toHaveBeenCalledWith(storageUrl, expect.objectContaining({ redirect: 'manual' }));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(response.status).toBe(502);
    expect(response.headers.has('location')).toBe(false);
  });

  it.each([
    'http://127.0.0.1/private',
    'http://files.example.com/part.pdf',
    'https://user@files.example.com/part.pdf',
  ])('rejects an unsafe backend-provided URL without fetching storage: %s', async (url) => {
    fetchMock.mockResolvedValue(Response.json({ url }));
    const response = await GET(request({ itemId: ITEM_ID, fileType: '2d' }));
    expect(response.status).toBe(502);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it.each(['..', '.', '../../admin', 'item-1', `${ITEM_ID}/../x`])(
    'rejects an item id that is not a UUID without calling the backend: %s',
    async (itemId) => {
      const response = await GET(request({ itemId, fileType: '2d' }));
      expect(response.status).toBe(400);
      expect(fetchMock).not.toHaveBeenCalled();
    },
  );

  it('asks the backend without following redirects', async () => {
    fetchMock.mockResolvedValueOnce(Response.json({ url: storageUrl }))
      .mockResolvedValueOnce(new Response('file-bytes'));
    await GET(request({ itemId: ITEM_ID, fileType: '2d' }));
    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      expect.stringMatching(new RegExp(`/bom-items/${ITEM_ID}/file-url/2d$`)),
      expect.objectContaining({ redirect: 'error' }),
    );
  });

  it("asks the backend with the session's token, never a header the browser sent", async () => {
    fetchMock.mockResolvedValueOnce(Response.json({ url: storageUrl }))
      .mockResolvedValueOnce(new Response('file-bytes'));
    const req = new NextRequest(`http://localhost/api/file-proxy?itemId=${ITEM_ID}&fileType=2d`, {
      headers: { authorization: 'Bearer browser-token' },
    });
    await GET(req);
    const init = fetchMock.mock.calls[0][1];
    expect((init?.headers as Record<string, string>).Authorization).toBe('Bearer session-token');
  });

  it('serves a PDF inline inside a CSP sandbox, so it is not active content of the app origin', async () => {
    fetchMock.mockResolvedValue(new Response('%PDF', { headers: { 'Content-Type': 'application/pdf' } }));
    const response = await GET(request({ url: storageUrl }));
    expect(response.status).toBe(200);
    expect(response.headers.get('content-security-policy')).toBe('sandbox');
    expect(response.headers.get('content-disposition')).toBe('inline');
  });

  it('serves images without a sandbox and other data with a strict one', async () => {
    fetchMock.mockResolvedValueOnce(new Response('png', { headers: { 'Content-Type': 'image/png' } }));
    expect((await GET(request({ url: storageUrl }))).headers.get('content-security-policy')).toBeNull();
    fetchMock.mockResolvedValueOnce(new Response('step', { headers: { 'Content-Type': 'application/step' } }));
    expect((await GET(request({ url: storageUrl }))).headers.get('content-security-policy')).toBe("sandbox; default-src 'none'");
  });

  it('streams a trusted backend-provided file URL', async () => {
    fetchMock.mockResolvedValueOnce(Response.json({ url: storageUrl }))
      .mockResolvedValueOnce(new Response('file-bytes'));
    const response = await GET(request({ itemId: ITEM_ID, fileType: '3d' }));
    expect(response.status).toBe(200);
    expect(fetchMock).toHaveBeenNthCalledWith(2, storageUrl, expect.objectContaining({ redirect: 'manual' }));
    expect(await response.text()).toBe('file-bytes');
  });
});
