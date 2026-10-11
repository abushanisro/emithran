import { describe, expect, it } from 'vitest';

import {
  isServableContentType, isTrustedStorageUrl, limitStream, PayloadTooLargeError, readLimited,
} from '@/lib/server/safe-fetch';

const HOSTS = ['abc.supabase.co'];

describe('isTrustedStorageUrl', () => {
  it('accepts https on the project storage host and its subdomains', () => {
    expect(isTrustedStorageUrl('https://abc.supabase.co/storage/v1/object/sign/x.pdf?token=t', HOSTS)).toBe(true);
    expect(isTrustedStorageUrl('https://files.abc.supabase.co/x', HOSTS)).toBe(true);
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

  it('allows plain http only for a configured local host', () => {
    expect(isTrustedStorageUrl('http://127.0.0.1:54321/storage/x', ['127.0.0.1'])).toBe(true);
    expect(isTrustedStorageUrl('http://127.0.0.1:54321/storage/x', HOSTS)).toBe(false);
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
