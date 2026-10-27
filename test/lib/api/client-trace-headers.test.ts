import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { apiClient } from '@/lib/api/client';
import { setupInterceptors } from '@/lib/api/interceptors';
import { correlationManager } from '@/lib/utils/tracing';

// The real ApiClient, the real interceptor chain as lib/api/init.ts registers it, and only fetch replaced:
// what goes on the wire for each request.
interface Sent {
  traceparent: string | undefined;
  requestId: string | undefined;
  userId: string | undefined;
  all: Record<string, string>;
}

const okResponse = () => new Response(JSON.stringify({ success: true, data: { ok: true } }), { status: 200, headers: { 'content-type': 'application/json' } });
/** One segment of a traceparent: 1 = trace id, 2 = span id, 3 = flags. */
const part = (traceparent: string | undefined, index: number): string => (traceparent ?? '').split('-')[index] ?? '';

describe('headers the API client puts on the wire', () => {
  let sent: Sent[];
  let script: (() => Response)[];

  beforeEach(() => {
    sent = [];
    script = [];
    vi.stubGlobal(
      'fetch',
      vi.fn((_url: string, init?: RequestInit) => {
        const headers = Object.fromEntries(Object.entries((init?.headers ?? {}) as Record<string, string>).map(([k, v]) => [k.toLowerCase(), v]));
        sent.push({ traceparent: headers.traceparent, requestId: headers['x-request-id'], userId: headers['x-user-id'], all: headers });
        try {
          return Promise.resolve((script.shift() ?? okResponse)());
        } catch (error) {
          return Promise.reject(error instanceof Error ? error : new Error(String(error))); // a scripted network failure
        }
      }),
    );
    correlationManager.initialize({ sessionId: 'session-under-test', userId: 'user-must-not-be-sent' });
    setupInterceptors(apiClient); // as init.ts does
  });
  afterEach(() => vi.unstubAllGlobals());

  it('gives each request its own trace and request id, flagged not-sampled, and never the user id', async () => {
    await apiClient.get('/trace-a', { silent: true, cache: false } as never);
    await apiClient.get('/trace-b', { silent: true, cache: false } as never);

    expect(sent.length).toBeGreaterThanOrEqual(2);
    const [a, b] = sent.slice(-2);
    for (const request of [a, b]) {
      expect(request?.traceparent).toMatch(/^00-[0-9a-f]{32}-[0-9a-f]{16}-00$/);
      expect(request?.requestId).toMatch(/^[0-9a-f-]{36}$/);
      expect(request?.userId).toBeUndefined();
      expect(JSON.stringify(request?.all)).not.toContain('user-must-not-be-sent');
    }
    expect(part(a?.traceparent, 1)).not.toBe(part(b?.traceparent, 1)); // not one trace per session
    expect(a?.requestId).not.toBe(b?.requestId);
    expect(a?.all['x-session-id']).toBe('session-under-test'); // grouping ids still sent
  });

  it('keeps one trace and one request id across the retry attempts of a request, with a new span per attempt', async () => {
    script = [
      () => {
        throw new TypeError('Failed to fetch'); // a network failure: retried after a backoff
      },
    ];
    const before = sent.length;
    await apiClient.get('/trace-retry', { silent: true, cache: false } as never);

    const attempts = sent.slice(before);
    expect(attempts.length).toBeGreaterThanOrEqual(2); // the failed attempt was retried
    expect(new Set(attempts.map((s) => part(s.traceparent, 1))).size).toBe(1);
    expect(new Set(attempts.map((s) => s.requestId)).size).toBe(1);
    expect(new Set(attempts.map((s) => part(s.traceparent, 2))).size).toBe(attempts.length);
  }, 20_000);
});
