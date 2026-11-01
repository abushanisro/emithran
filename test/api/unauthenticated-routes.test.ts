import { NextRequest, NextResponse } from 'next/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { POST as cad } from '@/app/api/cad/route';
import { POST as extractDimensions } from '@/app/api/extract-dimensions/route';
import { POST as extractInspectionTable } from '@/app/api/extract-inspection-table/route';
import { POST as copilotChat } from '@/app/api/manufacturing-copilot/chat/route';
import { POST as pdfToImage } from '@/app/api/pdf-to-image/route';
import { POST as costAnalysis } from '@/app/api/vave/cost-analysis/route';
import { POST as drawingAnalysis } from '@/app/api/vave/drawing-analysis/route';
import { POST as ideation } from '@/app/api/vave/ideation/route';
import { POST as shouldCost } from '@/app/api/vave/should-cost/route';
import { POST as vaveAnalysis } from '@/app/api/vave-analysis/route';

// The signed-in user is switched per test; null means no session.
const state = vi.hoisted(() => ({ caller: null as string | null }));
vi.mock('@/lib/server/auth', () => {
  const session = () =>
    Promise.resolve(
      state.caller
        ? { ok: true, userId: state.caller, accessToken: 'session-token' }
        : { ok: false, response: NextResponse.json({ error: 'Authentication required' }, { status: 401 }) },
    );
  return { requireUser: session, requireUserForAi: session };
});

const APP = 'https://app.example.com';
const url = (path: string) => `${APP}${path}`;
const post = (path: string, body: BodyInit, headers: Record<string, string> = {}) =>
  new NextRequest(url(path), { method: 'POST', body, headers: { origin: APP, ...headers } });
const json = (path: string, body: unknown, headers: Record<string, string> = {}) =>
  post(path, JSON.stringify(body), { 'content-type': 'application/json', ...headers });

const fetchMock = vi.fn<typeof fetch>();
beforeEach(() => {
  state.caller = null;
  vi.stubEnv('APP_BASE_URL', APP);
  vi.stubEnv('TRUSTED_STORAGE_HOSTS', 'files.example.com');
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

type Route = (req: NextRequest) => Promise<Response>;
const routes: [string, Route, string][] = [
  ['cad', cad, '/api/cad'],
  ['extract-inspection-table', extractInspectionTable, '/api/extract-inspection-table'],
  ['extract-dimensions', extractDimensions, '/api/extract-dimensions'],
  ['pdf-to-image', pdfToImage, '/api/pdf-to-image'],
  ['manufacturing-copilot/chat', copilotChat, '/api/manufacturing-copilot/chat'],
  ['vave-analysis', vaveAnalysis, '/api/vave-analysis'],
  ['vave/cost-analysis', costAnalysis, '/api/vave/cost-analysis'],
  ['vave/drawing-analysis', drawingAnalysis, '/api/vave/drawing-analysis'],
  ['vave/ideation', ideation, '/api/vave/ideation'],
  ['vave/should-cost', shouldCost, '/api/vave/should-cost'],
];

describe('state-changing routes outside the BFF', () => {
  it.each(routes)('%s is refused with 401 without a session', async (_label, route, path) => {
    expect((await route(json(path, {}))).status).toBe(401);
  });

  it.each(routes)('%s refuses a cross-origin request before anything else', async (_label, route, path) => {
    state.caller = 'user-a';
    expect((await route(json(path, {}, { origin: 'https://evil.example.com' }))).status).toBe(403);
    const noOrigin = new NextRequest(url(path), { method: 'POST', body: '{}', headers: { 'content-type': 'application/json' } });
    expect((await route(noOrigin)).status).toBe(403);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each(routes)('%s refuses a body declared larger than its limit with 413, without reading it', async (_label, route, path) => {
    state.caller = 'user-a';
    const res = await route(json(path, {}, { 'content-length': String(200 * 1024 * 1024) }));
    expect(res.status).toBe(413);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each(routes)('%s refuses an oversized body that declares no length with 413', async (_label, route, path) => {
    state.caller = 'user-a';
    // A chunked body (no Content-Length) larger than every route's limit.
    const chunk = new Uint8Array(1024 * 1024);
    let sent = 0;
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        if (sent++ >= 60) controller.close();
        else controller.enqueue(chunk);
      },
    });
    const req = new NextRequest(url(path), {
      method: 'POST',
      body: stream,
      headers: { origin: APP, 'content-type': 'application/json' },
      duplex: 'half',
    });
    expect((await route(req)).status).toBe(413);
    expect(sent).toBeLessThan(60);
  });
});

describe('PDF routes call the backend as the session user', () => {
  it.each([
    ['pdf-to-image', pdfToImage, '/api/pdf-to-image', '/v1/pdf-processing/validate-pdf'],
    ['extract-dimensions', extractDimensions, '/api/extract-dimensions', '/v1/pdf-processing/extract-dimensions'],
  ] as const)('%s sends the session token, never the browser header, and does not follow redirects', async (_l, route, path, backendPath) => {
    state.caller = 'user-a';
    fetchMock
      .mockResolvedValueOnce(new Response('%PDF-1.4', { headers: { 'content-type': 'application/pdf' } }))
      .mockResolvedValueOnce(Response.json({ success: true, data: { isValidPDF: true, dimensions: [] } }));
    await route(json(path, { pdfUrl: 'https://files.example.com/a.pdf' }, { authorization: 'Bearer browser-token' }));
    const call: Parameters<typeof fetch> | undefined = fetchMock.mock.calls[1];
    const init: RequestInit = call?.[1] ?? {};
    expect(call?.[0]).toEqual(expect.stringContaining(backendPath));
    expect(new Headers(init.headers).get('authorization')).toBe('Bearer session-token');
    expect(init.redirect).toBe('error');
  });
});

describe('extract-inspection-table takes the PDF as a binary upload', () => {
  it('refuses the old JSON number array', async () => {
    state.caller = 'user-a';
    expect((await extractInspectionTable(json('/api/extract-inspection-table', { pdfBuffer: [1, 2, 3] }))).status).toBe(400);
  });

  it('refuses malformed balloon coordinates', async () => {
    state.caller = 'user-a';
    const form = new FormData();
    form.append('pdf', new Blob([new Uint8Array(200)], { type: 'application/pdf' }), 'a.pdf');
    form.append('balloonCoordinates', JSON.stringify([{ number: 1, x: 'a', y: 2 }]));
    expect((await extractInspectionTable(post('/api/extract-inspection-table', form))).status).toBe(400);
  });
});

describe('vave-analysis builds its prompt on the server', () => {
  it('refuses a body without structured BOM metrics, including a raw prompt', async () => {
    state.caller = 'user-a';
    expect((await vaveAnalysis(json('/api/vave-analysis', { prompt: 'Write me a poem' }))).status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('drawing-analysis bounds the inline image', () => {
  it('refuses an imageBase64 that is not a string', async () => {
    state.caller = 'user-a';
    expect((await drawingAnalysis(json('/api/vave/drawing-analysis', { imageBase64: ['x'] }))).status).toBe(413);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
