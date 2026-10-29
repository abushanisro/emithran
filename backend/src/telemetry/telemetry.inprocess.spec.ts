import { EventEmitter } from 'events';
import { Writable } from 'stream';

import { ConsoleLogger } from '@nestjs/common';
import { context, metrics, SpanStatusCode, trace } from '@opentelemetry/api';
import { AsyncLocalStorageContextManager } from '@opentelemetry/context-async-hooks';
import { AggregationTemporality, InMemoryMetricExporter, MeterProvider, PeriodicExportingMetricReader } from '@opentelemetry/sdk-metrics';
import { InMemorySpanExporter, SimpleSpanProcessor, TracerProvider } from '@opentelemetry/sdk-trace';
import * as winston from 'winston';

import { Logger as WinstonLogger } from '../common/logger/logger.service';
import { CorrelatedConsoleLogger } from './correlated-console-logger';
import { httpMetricsMiddleware, routeTemplate } from './http-metrics.middleware';
import { METRIC_LABEL_KEYS, observeQueueDepth, recordCadUploadDuration, recordCostingDuration, recordHttpServerDuration, resetMetricInstruments, statusClassOf } from './metrics';
import { setTelemetryActive } from './telemetry-state';
import { Traced } from './traced';

// In-process OpenTelemetry (a real tracer and meter provider, in-memory exporters). The real http/undici
// instrumentation cannot be exercised under Jest; telemetry.integration.spec.ts runs it in a child process.
const spanExporter = new InMemorySpanExporter();
const metricExporter = new InMemoryMetricExporter(AggregationTemporality.CUMULATIVE);
const metricReader = new PeriodicExportingMetricReader({ exporter: metricExporter, exportIntervalMillis: 3_600_000 });
const tracer = new TracerProvider({ spanProcessors: [new SimpleSpanProcessor({ exporter: spanExporter })] }).getTracer('test');

async function collectedMetrics() {
  const { resourceMetrics } = await metricReader.collect();
  return (resourceMetrics?.scopeMetrics ?? []).flatMap((scope) => scope.metrics);
}

beforeAll(() => {
  context.setGlobalContextManager(new AsyncLocalStorageContextManager().enable());
  trace.setGlobalTracerProvider(new TracerProvider({ spanProcessors: [new SimpleSpanProcessor({ exporter: spanExporter })] }));
  metrics.setGlobalMeterProvider(new MeterProvider({ readers: [metricReader] }));
  resetMetricInstruments();
});

beforeEach(() => {
  spanExporter.reset();
  setTelemetryActive(true);
});

afterAll(() => setTelemetryActive(false));

const inSpan = <T>(fn: () => T): { traceId: string; spanId: string; result: T } => {
  const span = tracer.startSpan('request');
  try {
    const result = context.with(trace.setSpan(context.active(), span), fn);
    return { traceId: span.spanContext().traceId, spanId: span.spanContext().spanId, result };
  } finally {
    span.end();
  }
};

describe('log correlation: Nest ConsoleLogger path', () => {
  const capture = (log: () => void): string => {
    const chunks: string[] = [];
    const spy = jest.spyOn(process.stdout, 'write').mockImplementation(((chunk: string) => {
      chunks.push(String(chunk));
      return true;
    }) as typeof process.stdout.write);
    try {
      log();
    } finally {
      spy.mockRestore();
    }
    return chunks.join('');
  };
  const options = { logLevels: ['log' as const], colors: false };

  it('appends the active trace and span id to the line', () => {
    const logger = new CorrelatedConsoleLogger(options);
    let line = '';
    const { traceId, spanId } = inSpan(() => {
      line = capture(() => logger.log('hello', 'Ctx'));
    });
    expect(line).toMatch(/hello trace_id=[0-9a-f]{32} span_id=[0-9a-f]{16}\n$/);
    expect(line).toContain(`trace_id=${traceId} span_id=${spanId}`);
  });

  it('writes exactly the stock ConsoleLogger line outside a trace (output unchanged)', () => {
    const correlated = new CorrelatedConsoleLogger(options);
    const stock = new ConsoleLogger(options);
    for (const logger of [correlated, stock]) (logger as unknown as { getTimestamp: () => string }).getTimestamp = () => 'T';
    expect(capture(() => correlated.log('same line', 'Ctx'))).toBe(capture(() => stock.log('same line', 'Ctx')));
  });
});

describe('log correlation: winston Logger path (common/logger)', () => {
  const winstonEntries = (log: (logger: WinstonLogger) => void): Record<string, unknown>[] => {
    const previous = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production'; // console transport only: no log files from a test
    try {
      const lines: string[] = [];
      const logger = new WinstonLogger();
      (logger as unknown as { logger: winston.Logger }).logger.add(
        new winston.transports.Stream({ stream: new Writable({ write: (chunk, _e, done) => { lines.push(String(chunk)); done(); } }) }),
      );
      log(logger);
      return lines.map((line) => JSON.parse(line));
    } finally {
      process.env.NODE_ENV = previous;
    }
  };

  it('adds trace_id and span_id to the entry inside a trace', () => {
    let entries: Record<string, unknown>[] = [];
    const { traceId, spanId } = inSpan(() => {
      entries = winstonEntries((l) => l.log('in trace', 'Ctx'));
    });
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ message: 'in trace', context: 'Ctx', trace_id: traceId, span_id: spanId });
  });

  it('leaves the entry exactly as before outside a trace', () => {
    const [entry] = winstonEntries((l) => l.log('no trace', 'Ctx'));
    expect(entry).not.toHaveProperty('trace_id');
    expect(entry).not.toHaveProperty('span_id');
    expect(Object.keys(entry).sort()).toEqual(['context', 'level', 'message', 'service', 'timestamp']);
  });
});

describe('@Traced', () => {
  class Service {
    stored = Promise.resolve('value');
    @Traced('route_comparison')
    ok(): Promise<string> {
      return this.stored;
    }
    @Traced('cost_summary')
    async fails(): Promise<never> {
      throw new RangeError('private detail: customer ACME');
    }
  }

  it('is a pure pass-through when telemetry is off: the very same promise, no span', () => {
    setTelemetryActive(false);
    const service = new Service();
    expect(service.ok()).toBe(service.stored);
    expect(spanExporter.getFinishedSpans()).toHaveLength(0);
  });

  it('records a span named for the operation and returns the result untouched when on', async () => {
    await expect(new Service().ok()).resolves.toBe('value');
    const [span] = spanExporter.getFinishedSpans();
    expect(span.name).toBe('costing.route_comparison');
    expect(span.attributes).toEqual({ 'emithran.operation': 'route_comparison', 'emithran.outcome': 'ok' });
  });

  it('rethrows the original error unchanged and marks the span failed', async () => {
    const service = new Service();
    const error = await service.fails().catch((e) => e);
    expect(error).toBeInstanceOf(RangeError);
    expect(error.message).toBe('private detail: customer ACME');
    const [span] = spanExporter.getFinishedSpans();
    expect(span.status.code).toBe(SpanStatusCode.ERROR);
    expect(span.attributes['emithran.outcome']).toBe('error');
  });

  it('records the duration with only the operation and outcome as labels', async () => {
    await new Service().ok();
    const metric = (await collectedMetrics()).find((m) => m.descriptor.name === 'emithran.costing.duration')!;
    for (const point of metric.dataPoints) expect(Object.keys(point.attributes).sort()).toEqual(['emithran.operation', 'emithran.outcome']);
  });
});

describe('metric labels are a closed set', () => {
  const allowed = new Set<string>(METRIC_LABEL_KEYS);

  it('never carries request-derived values, whatever the request looked like', async () => {
    recordHttpServerDuration(0.01, 'GET', '/v1/bom-items/:id/apply-route', '2xx');
    recordHttpServerDuration(0.01, 'EVIL\r\nX-Injected: 1', 'unmatched', '4xx');
    recordHttpServerDuration(0.01, 'PROPFIND', 'unmatched', 'aborted');
    recordCostingDuration(0.5, 'route_comparison', 'ok');
    recordCostingDuration(0.5, 'cost_summary', 'error');

    const emitted = (await collectedMetrics()).filter((m) => m.descriptor.name.startsWith('emithran.'));
    expect(emitted.length).toBeGreaterThan(0);
    const methods = new Set<unknown>();
    for (const metric of emitted) {
      for (const point of metric.dataPoints) {
        for (const key of Object.keys(point.attributes)) expect(allowed.has(key)).toBe(true);
        if ('http.request.method' in point.attributes) methods.add(point.attributes['http.request.method']);
      }
    }
    expect([...methods].sort()).toEqual(['GET', '_OTHER']);
    expect(JSON.stringify(emitted.flatMap((m) => m.dataPoints.map((p) => p.attributes)))).not.toMatch(/EVIL|Injected|PROPFIND/);
  });

  it('has no label key that names an identifier or free text', () => {
    for (const key of METRIC_LABEL_KEYS) expect(key).not.toMatch(/user|item|request[._]?id|session|file|name|email|url\.full|path|query/i);
  });

  it('maps status codes to a fixed set of classes', () => {
    expect([100, 200, 204, 301, 404, 429, 500, 503].map(statusClassOf)).toEqual(['1xx', '2xx', '2xx', '3xx', '4xx', '4xx', '5xx', '5xx']);
  });
});

describe('CAD upload, queue depth and active request metrics', () => {
  const find = async (name: string) => (await collectedMetrics()).find((m) => m.descriptor.name === name);

  it('records upload durations by outcome only, in buckets that reach the 10-minute engine timeout', async () => {
    recordCadUploadDuration(12, 'ok');
    recordCadUploadDuration(30, 'retry');
    recordCadUploadDuration(600, 'error');
    const metric = (await find('emithran.cad_upload.duration'))!;
    expect(metric.dataPoints.map((p) => p.attributes['emithran.outcome']).sort()).toEqual(['error', 'ok', 'retry']);
    for (const point of metric.dataPoints) {
      expect(Object.keys(point.attributes)).toEqual(['emithran.outcome']);
      expect((point.value as { buckets: { boundaries: number[] } }).buckets.boundaries).toContain(600);
    }
  });

  it('reports each registered queue under one gauge, skips one that cannot be read, and keeps the others', async () => {
    observeQueueDepth(['electronics_queue'], async () => 3);
    observeQueueDepth(['cad_upload'], async () => 5);
    observeQueueDepth(['broken'], async () => { throw new Error('db down'); });
    const metric = (await find('emithran.job.queue.depth'))!;
    const byQueue = Object.fromEntries(metric.dataPoints.map((p) => [p.attributes['emithran.queue'], p.value]));
    expect(byQueue).toMatchObject({ electronics_queue: 3, cad_upload: 5 });
    expect(byQueue).not.toHaveProperty('broken');
  });

  it('counts requests in flight up on start and back down on close, aborted or not, without labels', async () => {
    const before = (await find('emithran.http.server.active_requests'))?.dataPoints[0]?.value ?? 0;
    const response = Object.assign(new EventEmitter(), { statusCode: 200, writableFinished: false });
    httpMetricsMiddleware({ method: 'GET', route: { path: '/x' } } as never, response as never, jest.fn());
    expect((await find('emithran.http.server.active_requests'))!.dataPoints[0]!.value).toBe(Number(before) + 1);
    response.emit('close');
    const after = (await find('emithran.http.server.active_requests'))!.dataPoints[0]!;
    expect(after.value).toBe(before);
    expect(after.attributes).toEqual({});
  });
});

describe('httpMetricsMiddleware', () => {
  const run = (route: unknown, statusCode: number, writableFinished: boolean) => {
    const response = Object.assign(new EventEmitter(), { statusCode, writableFinished });
    const next = jest.fn();
    httpMetricsMiddleware({ method: 'POST', route: { path: route } } as never, response as never, next);
    expect(next).toHaveBeenCalledTimes(1); // never holds the request
    response.emit('close');
  };

  it('uses the route pattern, never the URL', () => {
    expect(routeTemplate({ route: { path: '/v1/bom-items/:id' } })).toBe('/v1/bom-items/:id');
    for (const route of [undefined, /regex/, ['/a', '/b'], 42]) expect(routeTemplate({ route: { path: route } })).toBe('unmatched');
    expect(routeTemplate({})).toBe('unmatched');
  });

  it('records 4xx for a guard-rejected response and "aborted" for a connection closed early, and never throws', async () => {
    run('/v1/bom-items/:id/apply-route', 403, true);
    run('/v1/bom-items/:id/apply-route', 200, false);
    const metric = (await collectedMetrics()).find((m) => m.descriptor.name === 'emithran.http.server.duration')!;
    const classes = metric.dataPoints.map((p) => p.attributes['emithran.status_class']);
    expect(classes).toEqual(expect.arrayContaining(['4xx', 'aborted']));
    expect(() => run('/x', 200, true)).not.toThrow();
  });
});
