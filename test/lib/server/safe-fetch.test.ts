import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  fetchTrustedFile, isServableContentType, isTrustedStorageUrl, limitStream, PayloadTooLargeError, readLimited,
  UntrustedUrlError,
} from '@/lib/server/safe-fetch';

const HOSTS = ['abc.supabase.co'];

describe('isTrustedStorageUrl', () => {
  it('accepts https on exactly the configured storage host', () => {
    expect(isTrustedStorageUrl('https://abc.supabase.co/storage/v1/object/sign/x.pdf?token=t', HOSTS)).toBe(true);
    expect(isTrustedStorageUrl('https://abc.supabase.co:443/x', HOSTS)).toBe(true);
  });

  it('refuses subdomains of a trusted host and non-default ports', () => {
    // A shared provider host (e.g. an S3 endpoint) would otherwise admit every other bucket.
    expect(isTrustedStorageUrl('https://files.abc.supabase.co/x', HOSTS)).toBe(false);
    expect(isTrustedStorageUrl('https://other-bucket.s3.amazonaws.com/x', ['s3.amazonaws.com'])).toBe(false);
    expect(isTrustedStorageUrl('https://abc.supabase.co:8443/x', HOSTS)).toBe(false);
    expect(isTrustedStorageUrl('https://abc.supabase.co:8443/x', ['abc.supabase.co:8443'])).toBe(true);
  });

  it('refuses private, loopback and metadata addresses', () => {
    for (const u of ['http://127.0.0.1:4000/', 'http://169.254.169.254/latest/meta-data', 'http://10.0.0.5/x', 'https://localhost/x', 'http://[::1]/x']) {
      expect(isTrustedStorageUrl(u, HOSTS)).toBe(false);
    }
  });

  it('refuses look-alike hosts, other buckets, credentials and odd schemes', () => {
    for (const u of [
      'https://abc.supabase.co.evil.com/x', 'https://evilabc.supabase.co/x', 'https://evil.amazonaws.com/x',
      'https://user:pw@abc.supabase.co/x', 'ftp://abc.supabase.co/x', 'file:///etc/passwd', 'not a url', 'http://abc.supabase.co/x',
    ]) {
      expect(isTrustedStorageUrl(u, HOSTS)).toBe(false);
    }
  });

  it('allows plain http only for a configured local host outside production', () => {
    expect(isTrustedStorageUrl('http://127.0.0.1:54321/storage/x', ['127.0.0.1:54321'], 'development')).toBe(true);
    expect(isTrustedStorageUrl('http://127.0.0.1:54321/storage/x', ['127.0.0.1:54321'], 'production')).toBe(false);
    expect(isTrustedStorageUrl('http://127.0.0.1:54321/storage/x', HOSTS, 'development')).toBe(false);
    expect(isTrustedStorageUrl('http://abc.supabase.co/x', HOSTS, 'development')).toBe(false);
  });
});

describe('fetchTrustedFile redirects', () => {
  const fetchMock = vi.fn<typeof fetch>();
  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
    vi.stubEnv('TRUSTED_STORAGE_HOSTS', 'files.example.com,other.example.com');
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });
  const redirectTo = (location: string) => new Response(null, { status: 302, headers: { Location: location } });

  it('refuses an untrusted URL without fetching', async () => {
    await expect(fetchTrustedFile('https://evil.example/x')).rejects.toBeInstanceOf(UntrustedUrlError);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('follows a redirect on the same origin', async () => {
    fetchMock.mockResolvedValueOnce(redirectTo('/y')).mockResolvedValueOnce(new Response('ok'));
    const res = await fetchTrustedFile('https://files.example.com/x');
    expect(await res.text()).toBe('ok');
    expect(fetchMock).toHaveBeenNthCalledWith(2, 'https://files.example.com/y', expect.objectContaining({ redirect: 'manual' }));
  });

  it.each([
    'https://other.example.com/x',
    'http://files.example.com/x',
    'http://169.254.169.254/latest',
    'https://files.example.com:8443/x',
  ])('refuses a redirect to another origin, even a trusted one: %s', async (location) => {
    fetchMock.mockResolvedValueOnce(redirectTo(location));
    await expect(fetchTrustedFile('https://files.example.com/x')).rejects.toBeInstanceOf(UntrustedUrlError);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe('isServableContentType', () => {
  it('serves documents, images and CAD models', () => {
    for (const t of ['application/pdf', 'image/png', 'image/jpeg', 'application/octet-stream', 'model/stl', 'text/plain; charset=utf-8', 'application/sla']) {
      expect(isServableContentType(t)).toBe(true);
    }
  });

  it('refuses anything a browser would render as a page or script', () => {
    for (const t of ['text/html', 'text/html; charset=utf-8', 'image/svg+xml', 'application/xhtml+xml', 'text/javascript', 'application/xml', '', null]) {
      expect(isServableContentType(t as string | null)).toBe(false);
    }
  });
});

describe('size limits', () => {
  const resOf = (bytes: number, headers: Record<string, string> = {}) =>
    new Response(new Uint8Array(bytes), { headers });

  it('readLimited returns a body within the limit', async () => {
    expect((await readLimited(resOf(100), 1000)).length).toBe(100);
  });

  it('readLimited refuses a declared or actual size over the limit', async () => {
    await expect(readLimited(resOf(10, { 'content-length': '5000' }), 1000)).rejects.toBeInstanceOf(PayloadTooLargeError);
    await expect(readLimited(resOf(5000), 1000)).rejects.toBeInstanceOf(PayloadTooLargeError);
  });

  it('limitStream passes small bodies and errors on large ones', async () => {
    const ok = await new Response(limitStream(resOf(100).body!, 1000)).arrayBuffer();
    expect(ok.byteLength).toBe(100);
    await expect(new Response(limitStream(resOf(5000).body!, 1000)).arrayBuffer()).rejects.toBeInstanceOf(PayloadTooLargeError);
  });
});
