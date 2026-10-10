import { test, expect, request as pwRequest } from '@playwright/test';

// Smoke checks for the Next API routes that spend money or fetch on the caller's
// behalf: they refuse anonymous callers, and a signed-in caller still cannot make
// the server fetch an untrusted address. Nothing here reaches a paid service.
const BASE = process.env.E2E_BASE_URL ?? 'http://localhost:3000';

const AI_ROUTES = [
  '/api/vave-analysis',
  '/api/vave/cost-analysis',
  '/api/vave/ideation',
  '/api/vave/should-cost',
  '/api/vave/drawing-analysis',
  '/api/manufacturing-copilot/chat',
];

test.describe('anonymous caller', () => {
  for (const route of AI_ROUTES) {
    test(`POST ${route} is refused`, async () => {
      const anon = await pwRequest.newContext({ baseURL: BASE, storageState: { cookies: [], origins: [] } });
      const res = await anon.post(route, { data: { prompt: 'x', bomItemId: 'x' } });
      expect(res.status()).toBe(401);
      await anon.dispose();
    });
  }

  for (const route of ['/api/extract-dimensions', '/api/pdf-to-image']) {
    test(`POST ${route} is refused`, async () => {
      const anon = await pwRequest.newContext({ baseURL: BASE, storageState: { cookies: [], origins: [] } });
      const res = await anon.post(route, { data: { pdfUrl: 'https://example.com/x.pdf' } });
      expect(res.status()).toBe(401);
      await anon.dispose();
    });
  }

  test('GET /api/file-proxy is refused', async () => {
    const anon = await pwRequest.newContext({ baseURL: BASE, storageState: { cookies: [], origins: [] } });
    const res = await anon.get('/api/file-proxy?url=https://example.com/x.pdf');
    expect(res.status()).toBe(401);
    await anon.dispose();
  });
});

test.describe('signed-in caller', () => {
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
