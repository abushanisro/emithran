import { NextRequest } from 'next/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { GET } from '@/app/api/file-proxy/route';

// The route requires a signed-in user (lib/server/auth); these tests are about
// the destination boundary, so the caller is signed in.
vi.mock('@/lib/server/auth', () => ({
  requireUser: () => Promise.resolve({ ok: true, userId: 'user-1' }),
}));

const fetchMock = vi.fn<typeof fetch>();
const storageUrl = 'https://files.supabase.co/storage/v1/object/sign/drawings/part.pdf';
const request = (params: Record<string, string>) =>
  new NextRequest(`http://localhost/api/file-proxy?${new URLSearchParams(params)}`);

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
  // The project storage host (lib/server/safe-fetch reads it per call).
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://files.supabase.co');
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe('file proxy destination boundary', () => {
  it.each([
    'https://untrusted.example/part.pdf',
    'https://supabase.co.untrusted.example/part.pdf',
    'http://files.supabase.co/part.pdf',
    'ftp://files.supabase.co/part.pdf',
    'https://user@files.supabase.co/part.pdf',
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
    'http://files.supabase.co/part.pdf',
    'https://user@files.supabase.co/part.pdf',
  ])('rejects an unsafe backend-provided URL without fetching storage: %s', async (url) => {
    fetchMock.mockResolvedValue(Response.json({ url }));
    const response = await GET(request({ itemId: 'item-1', fileType: '2d' }));
    expect(response.status).toBe(502);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('streams a trusted backend-provided file URL', async () => {
    fetchMock.mockResolvedValueOnce(Response.json({ url: storageUrl }))
      .mockResolvedValueOnce(new Response('file-bytes'));
    const response = await GET(request({ itemId: 'item-1', fileType: '3d' }));
    expect(response.status).toBe(200);
    expect(fetchMock).toHaveBeenNthCalledWith(2, storageUrl, expect.objectContaining({ redirect: 'manual' }));
    expect(await response.text()).toBe('file-bytes');
  });
});
