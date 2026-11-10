import { test, expect, request as pwRequest } from '@playwright/test';

// Smoke checks for the Next API routes that spend money or fetch on the caller's
// behalf: they refuse anonymous callers, and a signed-in caller still cannot make
// the server fetch an untrusted address. Nothing here reaches a paid service.
const BASE = process.env.E2E_BASE_URL ?? 'http://localhost:3000';
// A browser sends its own origin on every state-changing request; the routes refuse one without it (403, refuseCrossOrigin) BEFORE they check the
// caller or the address. Without this header every case below stopped at that first check and never reached what it is meant to test.
const SAME_ORIGIN = { origin: BASE };

// The VAVE AI analyses run in the backend (POST /api/v1/vave-projects/.../ai/*, behind the BFF and its own auth), not as Next routes.
const AI_ROUTES = [
  '/api/vave/drawing-analysis',
  '/api/manufacturing-copilot/chat',
];

test.describe('anonymous caller', () => {
  for (const route of AI_ROUTES) {
    test(`POST ${route} is refused`, async () => {
      const anon = await pwRequest.newContext({ baseURL: BASE, extraHTTPHeaders: SAME_ORIGIN, storageState: { cookies: [], origins: [] } });
      const res = await anon.post(route, { data: { prompt: 'x', bomItemId: 'x' } });
      expect(res.status()).toBe(401);
      await anon.dispose();
    });
  }

  for (const route of ['/api/extract-dimensions', '/api/pdf-to-image']) {
    test(`POST ${route} is refused`, async () => {
      const anon = await pwRequest.newContext({ baseURL: BASE, extraHTTPHeaders: SAME_ORIGIN, storageState: { cookies: [], origins: [] } });
      const res = await anon.post(route, { data: { pdfUrl: 'https://example.com/x.pdf' } });
      expect(res.status()).toBe(401);
      await anon.dispose();
    });
  }

  test('GET /api/file-proxy is refused', async () => {
    const anon = await pwRequest.newContext({ baseURL: BASE, extraHTTPHeaders: SAME_ORIGIN, storageState: { cookies: [], origins: [] } });
    const res = await anon.get('/api/file-proxy?url=https://example.com/x.pdf');
    expect(res.status()).toBe(401);
    await anon.dispose();
  });
});

test.describe('signed-in caller', () => {
  test.use({ extraHTTPHeaders: SAME_ORIGIN });
  // These routes call requireUser, which has no dev bypass on purpose (they spend money): they need a real sign-in. The address rules themselves are
  // unit-tested without one in test/lib/server/safe-fetch.test.ts (metadata, loopback, private and foreign hosts).
  test.skip(process.env.NEXT_PUBLIC_DEV_AUTH_BYPASS === 'true', 'needs a real sign-in; the bypass does not cover server routes that spend money');
  const UNTRUSTED = ['http://169.254.169.254/latest/meta-data', 'http://127.0.0.1:4000/health', 'https://evil.example.com/x.pdf'];

  for (const url of UNTRUSTED) {
    test(`extract-dimensions will not fetch ${url}`, async ({ request }) => {
      const res = await request.post('/api/extract-dimensions', { data: { pdfUrl: url } });
      expect(res.status()).toBe(400);
    });

    test(`file-proxy will not fetch ${url}`, async ({ request }) => {
      const res = await request.get(`/api/file-proxy?url=${encodeURIComponent(url)}`);
      expect(res.status()).toBe(400);
    });
  }
});
