import { describe, expect, it, vi } from 'vitest';

import type { RequestConfig } from '@/lib/api/client';
import {
  MAX_RETAINED_SPANS,
  TraceManager,
  createRequestTrace,
  requestTraceHeaders,
  traceManager,
} from '@/lib/api/distributed-tracing';
import { correlationIdInterceptor } from '@/lib/api/interceptors';
import { correlationManager } from '@/lib/utils/tracing';

const TRACEPARENT = /^00-[0-9a-f]{32}-[0-9a-f]{16}-00$/;
const SPAN_ID = '00f067aa0ba902b7';

describe('per-request trace identity', () => {
  it('builds a valid W3C traceparent that says "not sampled" (the browser records nothing) plus the request id', () => {
    const trace = createRequestTrace();
    const headers = requestTraceHeaders(trace, SPAN_ID);
    expect(headers.traceparent).toMatch(TRACEPARENT);
    expect(headers.traceparent).toBe(`00-${trace.traceId}-${SPAN_ID}-00`);
    expect(headers['x-request-id']).toBe(trace.requestId);
    expect(trace.requestId).toMatch(/^[0-9a-f-]{36}$/);
    expect(Object.keys(headers).sort()).toEqual(['traceparent', 'x-request-id']); // nothing else, in particular no tracestate
  });

  it('gives every request its own trace and request id, never the session-wide one', () => {
    const session = traceManager.getOrCreateContext();
    const seen = new Set<string>();
    const requestIds = new Set<string>();
    for (let i = 0; i < 500; i += 1) {
      const trace = createRequestTrace();
      seen.add(trace.traceId);
      requestIds.add(trace.requestId);
      expect(trace.traceId).not.toBe(session.traceId);
      expect(trace.traceId).not.toBe('0'.repeat(32));
    }
    expect(seen.size).toBe(500);
    expect(requestIds.size).toBe(500);
  });

  it('keeps one trace and one request id across the retry attempts of a request, with a distinct span per attempt', () => {
    const trace = createRequestTrace();
    const first = requestTraceHeaders(trace, '1111111111111111');
    const retry = requestTraceHeaders(trace, '2222222222222222');
    expect(first.traceparent.split('-')[1]).toBe(retry.traceparent.split('-')[1]);
    expect(first['x-request-id']).toBe(retry['x-request-id']);
    expect(first.traceparent.split('-')[2]).not.toBe(retry.traceparent.split('-')[2]);
  });
});

describe('TraceManager span retention', () => {
  it('records a span under the trace id it is given, so local logs match what the backend receives', () => {
    const manager = new TraceManager();
    const span = manager.startSpan('GET /x', {}, 'a'.repeat(32));
    expect(span.traceId).toBe('a'.repeat(32));
    expect(manager.startSpan('GET /y').traceId).toBe(manager.getCurrentContext()?.traceId); // unchanged default
  });

  it('keeps at most MAX_RETAINED_SPANS spans, dropping the oldest, so a long-lived tab does not grow without bound', () => {
    const manager = new TraceManager();
    const first = manager.startSpan('first');
    for (let i = 0; i < MAX_RETAINED_SPANS + 50; i += 1) manager.startSpan(`request ${i}`);
    expect(manager.getSpans()).toHaveLength(MAX_RETAINED_SPANS);
    expect(manager.getSpans().some((s) => s.spanId === first.spanId)).toBe(false);
    expect(manager.getSpans().at(-1)?.name).toBe(`request ${MAX_RETAINED_SPANS + 49}`);
  });
});

describe('correlationIdInterceptor no longer overrides the request trace', () => {
  const config = (headers: Record<string, string>): RequestConfig => ({ url: 'http://x/y', method: 'GET', headers, endpoint: '/y' });

  it('leaves traceparent and x-request-id as the request set them', () => {
    correlationManager.initialize({ sessionId: 'session-1' });
    const out = correlationIdInterceptor(config({ traceparent: `00-${'b'.repeat(32)}-${SPAN_ID}-00`, 'x-request-id': 'req-1' }));
    expect(out.headers.traceparent).toBe(`00-${'b'.repeat(32)}-${SPAN_ID}-00`);
    expect(out.headers['x-request-id']).toBe('req-1');
  });

  it('adds only the session-level grouping ids, and never the user id or a tracestate', () => {
    correlationManager.initialize({ sessionId: 'session-2', userId: 'user-123' });
    const out = correlationIdInterceptor(config({}));
    expect(Object.keys(out.headers).sort()).toEqual(['x-correlation-id', 'x-session-id']);
    expect(out.headers['x-session-id']).toBe('session-2');
    expect(JSON.stringify(out.headers)).not.toContain('user-123');
  });

  it('starts a context on first use (fresh module state) and still adds only the correlation id', async () => {
    vi.resetModules();
    const { correlationIdInterceptor: fresh } = await import('@/lib/api/interceptors');
    const out = fresh(config({}));
    expect(Object.keys(out.headers)).toEqual(['x-correlation-id']);
  });
});
