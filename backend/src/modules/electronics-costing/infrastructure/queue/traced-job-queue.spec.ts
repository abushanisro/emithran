import { context, metrics, propagation, trace } from '@opentelemetry/api';
import { AsyncLocalStorageContextManager } from '@opentelemetry/context-async-hooks';
import { W3CTraceContextPropagator } from '@opentelemetry/core';
import { AggregationTemporality, InMemoryMetricExporter, MeterProvider, PeriodicExportingMetricReader } from '@opentelemetry/sdk-metrics';
import { InMemorySpanExporter, SimpleSpanProcessor, TracerProvider } from '@opentelemetry/sdk-trace';

import { METRIC_LABEL_KEYS, resetMetricInstruments } from '../../../../telemetry/metrics';
import { TRACE_FIELD } from '../../../../telemetry/job-trace';
import { setTelemetryActive } from '../../../../telemetry/telemetry-state';
import { InMemoryJobQueue } from './in-memory-job-queue.adapter';
import { ELECTRONICS_QUEUES } from './job-queue.port';
import { TracedJobQueue } from './traced-job-queue';

const spans = new InMemorySpanExporter();
const metricExporter = new InMemoryMetricExporter(AggregationTemporality.CUMULATIVE);
const reader = new PeriodicExportingMetricReader({ exporter: metricExporter, exportIntervalMillis: 3_600_000 });
const tracer = new TracerProvider({ spanProcessors: [new SimpleSpanProcessor({ exporter: spans })] }).getTracer('test');
const collected = async () => (await reader.collect()).resourceMetrics?.scopeMetrics.flatMap((s) => s.metrics) ?? [];

beforeAll(() => {
  context.setGlobalContextManager(new AsyncLocalStorageContextManager().enable());
  propagation.setGlobalPropagator(new W3CTraceContextPropagator());
  trace.setGlobalTracerProvider(new TracerProvider({ spanProcessors: [new SimpleSpanProcessor({ exporter: spans })] }));
  metrics.setGlobalMeterProvider(new MeterProvider({ readers: [reader] }));
});
beforeEach(() => {
  spans.reset();
  resetMetricInstruments();
  setTelemetryActive(true);
});
afterAll(() => setTelemetryActive(false));

/** Runs `fn` inside a span standing in for the HTTP request that enqueues the job. */
const inRequest = async <T>(fn: () => Promise<T>) => {
  const span = tracer.startSpan('request');
  const result = await context.with(trace.setSpan(context.active(), span), fn);
  span.end();
  return { result, traceId: span.spanContext().traceId, spanId: span.spanContext().spanId };
};

describe('TracedJobQueue', () => {
  it('continues the producer\'s trace in the worker, and the handler never sees the trace field', async () => {
    const inner = new InMemoryJobQueue();
    const enqueue = jest.spyOn(inner, 'enqueue');
    const queue = new TracedJobQueue(inner);
    let seen: object | undefined;
    await queue.work<{ designId: string }>(ELECTRONICS_QUEUES.parse, async (payload) => {
      seen = payload;
      return { done: true };
    });

    const { traceId, spanId } = await inRequest(() => queue.enqueue(ELECTRONICS_QUEUES.parse, { designId: 'd-1' }));
    await inner.idle();

    // transported in the payload the backend stores, as ids only
    const stored = enqueue.mock.calls[0][1] as Record<string, string>;
    expect(stored.designId).toBe('d-1');
    expect(stored[TRACE_FIELD]).toMatch(new RegExp(`^00-${traceId}-${spanId}-0[01]$`));
    // the handler gets exactly the payload it was given
    expect(seen).toEqual({ designId: 'd-1' });

    const job = spans.getFinishedSpans().find((s) => s.name === 'job.electronics.parse')!;
    expect(job.kind).toBe(4); // CONSUMER
    expect(job.spanContext().traceId).toBe(traceId);
    expect(job.parentSpanContext?.spanId).toBe(spanId);
    expect(job.attributes).toEqual({ 'emithran.queue': 'electronics.parse', 'emithran.outcome': 'ok' });
  });

  it('is a pass-through when telemetry is off: same payload object, no span', async () => {
    setTelemetryActive(false);
    const inner = new InMemoryJobQueue();
    const enqueue = jest.spyOn(inner, 'enqueue');
    const queue = new TracedJobQueue(inner);
    let seen: object | undefined;
    await queue.work(ELECTRONICS_QUEUES.quote, async (payload) => {
      seen = payload;
      return {};
    });
    const payload = { quoteId: 'q-1' };
    await inRequest(() => queue.enqueue(ELECTRONICS_QUEUES.quote, payload));
    await inner.idle();

    expect(enqueue.mock.calls[0][1]).toBe(payload);
    expect(seen).toBe(payload);
    expect(spans.getFinishedSpans().filter((s) => s.name.startsWith('job.'))).toHaveLength(0);
  });

  it('adds no trace field when no trace is active at enqueue', async () => {
    const inner = new InMemoryJobQueue();
    const enqueue = jest.spyOn(inner, 'enqueue');
    const queue = new TracedJobQueue(inner);
    await queue.work(ELECTRONICS_QUEUES.parse, async () => ({}));
    await queue.enqueue(ELECTRONICS_QUEUES.parse, { designId: 'd-2' });
    await inner.idle();
    expect(enqueue.mock.calls[0][1]).toEqual({ designId: 'd-2' });
    expect(spans.getFinishedSpans().some((s) => s.name === 'job.electronics.parse')).toBe(true); // still traced, as a new root
  });

  it('starts a new trace instead of failing when the carried traceparent is malformed', async () => {
    const inner = new InMemoryJobQueue();
    const queue = new TracedJobQueue(inner);
    let seen: object | undefined;
    await queue.work(ELECTRONICS_QUEUES.parse, async (payload) => {
      seen = payload;
      return { ok: true };
    });
    const id = await inner.enqueue(ELECTRONICS_QUEUES.parse, { designId: 'd-3', [TRACE_FIELD]: 'not-a-traceparent' });
    await inner.idle();
    expect(await inner.status(ELECTRONICS_QUEUES.parse, id)).toMatchObject({ state: 'completed' });
    expect(seen).toEqual({ designId: 'd-3' });
    const job = spans.getFinishedSpans().find((s) => s.name === 'job.electronics.parse')!;
    expect(job.parentSpanContext).toBeUndefined();
  });

  it('records a failed attempt as an error, rethrows it unchanged, and the job still fails with its own message', async () => {
    const inner = new InMemoryJobQueue();
    const queue = new TracedJobQueue(inner);
    await queue.work(ELECTRONICS_QUEUES.quote, async () => {
      throw new RangeError('rate book missing');
    });
    const id = await queue.enqueue(ELECTRONICS_QUEUES.quote, { quoteId: 'q-9' });
    await inner.idle();

    expect(await queue.status(ELECTRONICS_QUEUES.quote, id)).toMatchObject({ state: 'failed', error: 'rate book missing' });
    const job = spans.getFinishedSpans().find((s) => s.name === 'job.electronics.quote')!;
    expect(job.status.code).toBe(2); // ERROR
    expect(job.attributes['emithran.outcome']).toBe('error');
    const duration = (await collected()).find((m) => m.descriptor.name === 'emithran.job.duration')!;
    expect(duration.dataPoints.map((p) => p.attributes)).toContainEqual({ 'emithran.queue': 'electronics.quote', 'emithran.outcome': 'error' });
  });

  it('labels job metrics only by queue and outcome', async () => {
    const inner = new InMemoryJobQueue();
    const queue = new TracedJobQueue(inner);
    await queue.work(ELECTRONICS_QUEUES.parse, async () => ({}));
    await queue.enqueue(ELECTRONICS_QUEUES.parse, { designId: 'secret-design-id' });
    await inner.idle();
    const duration = (await collected()).find((m) => m.descriptor.name === 'emithran.job.duration')!;
    for (const point of duration.dataPoints) expect(Object.keys(point.attributes).sort()).toEqual(['emithran.outcome', 'emithran.queue']);
    expect(JSON.stringify(duration.dataPoints.map((p) => p.attributes))).not.toContain('secret-design-id');
    expect(METRIC_LABEL_KEYS).toContain('emithran.queue');
  });

  describe('queue depth gauge', () => {
    it('reports the waiting jobs per queue when metrics are collected', async () => {
      const inner = new InMemoryJobQueue();
      const queue = new TracedJobQueue(inner);
      await queue.work(ELECTRONICS_QUEUES.parse, async () => ({}));
      await queue.enqueue(ELECTRONICS_QUEUES.parse, {});
      await queue.enqueue(ELECTRONICS_QUEUES.parse, {});

      const depth = (await collected()).find((m) => m.descriptor.name === 'emithran.job.queue.depth')!;
      const points = depth.dataPoints.map((p) => ({ queue: p.attributes['emithran.queue'], value: p.value }));
      expect(points).toContainEqual({ queue: 'electronics.parse', value: 2 });
      expect(points).toContainEqual({ queue: 'electronics.quote', value: 0 });
      await inner.idle();
    });

    it('skips a queue whose depth cannot be read, without throwing, and still reports the others', async () => {
      const inner = new InMemoryJobQueue();
      jest.spyOn(inner, 'depth').mockImplementation(async (name) => {
        if (name === ELECTRONICS_QUEUES.parse) throw new Error('database down');
        return 7;
      });
      new TracedJobQueue(inner);

      const depth = (await collected()).find((m) => m.descriptor.name === 'emithran.job.queue.depth')!;
      const points = depth.dataPoints.map((p) => ({ queue: p.attributes['emithran.queue'], value: p.value }));
      // The healthy queue is reported with fresh data. (A cumulative gauge keeps the LAST value of a series it
      // stops observing, so the failing queue may still carry an earlier point; what must hold is that nothing threw.)
      expect(points).toContainEqual({ queue: 'electronics.quote', value: 7 });
      expect(points.filter((p) => p.queue === 'electronics.parse').every((p) => p.value !== 7)).toBe(true);
    });

    it('does not wait on a hanging read longer than its bound', async () => {
      const inner = new InMemoryJobQueue();
      jest.spyOn(inner, 'depth').mockImplementation(() => new Promise(() => undefined)); // never settles
      new TracedJobQueue(inner);
      const started = Date.now();
      await collected();
      expect(Date.now() - started).toBeLessThan(4_000);
    }, 10_000);
  });

  it('delegates the rest of the port unchanged', async () => {
    const inner = new InMemoryJobQueue();
    const queue = new TracedJobQueue(inner);
    await expect(queue.health()).resolves.toEqual({ configured: true, ready: true });
    await expect(queue.start()).resolves.toBeUndefined();
    await expect(queue.stop()).resolves.toBeUndefined();
  });
});
