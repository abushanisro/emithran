import { diag, DiagLogLevel, type DiagLogger } from '@opentelemetry/api';
import type { IMetricReader } from '@opentelemetry/sdk-metrics';
import type { SpanExporter } from '@opentelemetry/sdk-trace';

import { setTelemetryActive } from './telemetry-state';
import { readTelemetryConfig, type TelemetryConfig } from './telemetry.config';
import { METRIC_LABEL_KEYS } from './metrics';
import { routeTemplate } from './http-metrics.middleware';

export interface TelemetryHandle {
  /** Exports what is buffered now, bounded by the export timeout. Never rejects. */
  flush(): Promise<void>;
  /** Flushes and stops, bounded by the configured shutdown timeout. Never rejects. */
  shutdown(): Promise<void>;
}

export interface StartOptions {
  env?: NodeJS.ProcessEnv;
  /** Test seams: replace the OTLP exporters (the production path never passes these). */
  traceExporter?: SpanExporter;
  metricReader?: IMetricReader;
}

// The diagnostic channel sometimes hands over a serialised Error (stack included). One short line is
// enough to act on; the stack of an exporter timeout says nothing more.
export function summarizeDiagMessage(raw: string): string {
  let text = String(raw);
  try {
    const parsed = JSON.parse(text) as { name?: string; message?: string };
    if (parsed && typeof parsed === 'object') text = [parsed.name, parsed.message].filter(Boolean).join(': ') || text;
  } catch {
    // not JSON: use as is
  }
  return text.split('\n')[0].slice(0, 200);
}

// Exporter problems (collector down, timeout, 4xx) arrive through OpenTelemetry's diagnostic channel.
// They are surfaced, but at most one line per minute with a count, so an outage of the telemetry
// backend can neither flood the application log nor go unnoticed.
class RateLimitedDiagLogger implements DiagLogger {
  private suppressed = 0;
  private lastPrintedAt = 0;

  constructor(private readonly intervalMs = 60_000, private readonly now: () => number = Date.now) {}

  private report(raw: string): void {
    const message = summarizeDiagMessage(raw);
    const at = this.now();
    if (at - this.lastPrintedAt < this.intervalMs) {
      this.suppressed += 1;
      return;
    }
    const more = this.suppressed > 0 ? ` (+${this.suppressed} similar in the last interval)` : '';
    this.suppressed = 0;
    this.lastPrintedAt = at;
    console.warn(`[telemetry] ${message}${more}`);
  }

  error = (message: string): void => this.report(message);
  warn = (message: string): void => this.report(message);
  info = (): void => undefined;
  debug = (): void => undefined;
  verbose = (): void => undefined;
}

export { RateLimitedDiagLogger };

/**
 * Starts OpenTelemetry when OTEL_EXPORTER_OTLP_ENDPOINT is set; otherwise returns null having
 * loaded nothing from the SDK (the SDK packages are required below, after the check). Must run
 * before the application imports http/express so the instrumentations can patch them: main.ts
 * calls it straight after loading .env.
 *
 * Never throws: a failure to start is reported and the API runs without telemetry.
 */
export function startTelemetry(options: StartOptions = {}): TelemetryHandle | null {
  const { config, warning } = readTelemetryConfig(options.env ?? process.env);
  if (warning) console.warn(`[telemetry] ${warning}`);
  if (!config) return null;

  try {
    return startSdk(config, options);
  } catch (error) {
    console.warn(`[telemetry] failed to start (${error instanceof Error ? error.name : 'error'}); running without telemetry.`);
    setTelemetryActive(false);
    return null;
  }
}

function startSdk(config: TelemetryConfig, options: StartOptions): TelemetryHandle {
  /* eslint-disable @typescript-eslint/no-require-imports -- loaded here, not at module top, so a disabled
     telemetry never loads the SDK. */
  const { NodeSDK } = require('@opentelemetry/sdk-node') as typeof import('@opentelemetry/sdk-node');
  const { OTLPTraceExporter } = require('@opentelemetry/exporter-trace-otlp-http') as typeof import('@opentelemetry/exporter-trace-otlp-http');
  const { OTLPMetricExporter } = require('@opentelemetry/exporter-metrics-otlp-http') as typeof import('@opentelemetry/exporter-metrics-otlp-http');
  const { BatchSpanProcessor, ParentBasedSampler, TraceIdRatioBasedSampler } = require('@opentelemetry/sdk-trace') as typeof import('@opentelemetry/sdk-trace');
  const { PeriodicExportingMetricReader, AggregationType, createAllowListAttributesProcessor } = require('@opentelemetry/sdk-metrics') as typeof import('@opentelemetry/sdk-metrics');
  const { resourceFromAttributes, envDetector } = require('@opentelemetry/resources') as typeof import('@opentelemetry/resources');
  const { W3CTraceContextPropagator } = require('@opentelemetry/core') as typeof import('@opentelemetry/core');
  const { HttpInstrumentation } = require('@opentelemetry/instrumentation-http') as typeof import('@opentelemetry/instrumentation-http');
  const { UndiciInstrumentation } = require('@opentelemetry/instrumentation-undici') as typeof import('@opentelemetry/instrumentation-undici');
  const { NestInstrumentation } = require('@opentelemetry/instrumentation-nestjs-core') as typeof import('@opentelemetry/instrumentation-nestjs-core');
  const { AllowListSpanProcessor } = require('./allow-list-span-processor') as typeof import('./allow-list-span-processor');
  /* eslint-enable @typescript-eslint/no-require-imports */

  diag.setLogger(new RateLimitedDiagLogger(), DiagLogLevel.WARN);

  const exporterLimits = { timeoutMillis: config.exportTimeoutMs, concurrencyLimit: 4 };
  const traceExporter = options.traceExporter ?? new OTLPTraceExporter({ url: `${config.endpoint}/v1/traces`, ...exporterLimits });
  const metricReader =
    options.metricReader ??
    new PeriodicExportingMetricReader({
      exporter: new OTLPMetricExporter({ url: config.metricsEndpoint, ...exporterLimits }),
      exportIntervalMillis: config.metricIntervalMs,
      exportTimeoutMillis: config.exportTimeoutMs,
    });

  // Health probes and the root route would dominate the traces and say nothing.
  const isProbe = (url: string | undefined): boolean => /^\/(ping|api\/health)(\/|\?|$)/.test(url ?? '') || url === '/';

  const batchProcessor = new BatchSpanProcessor({
    exporter: traceExporter,
    maxQueueSize: config.maxQueueSize,
    maxExportBatchSize: config.maxExportBatchSize,
    scheduledDelayMillis: config.scheduledDelayMs,
    exportTimeoutMillis: config.exportTimeoutMs,
  });

  const sdk = new NodeSDK({
    // Explicit resource and only the env detector: the default process/host detectors record the
    // command line and host name, which can carry secrets passed as arguments.
    resource: resourceFromAttributes({
      'service.name': config.serviceName,
      'deployment.environment.name': config.environment,
    }),
    resourceDetectors: [envDetector],
    // The keep-or-drop decision is always made HERE. An incoming traceparent still lends its trace id (so a browser
    // request and its backend trace correlate) but never its sampling flag: the web client marks every request
    // "sampled", and anyone on the internet can send that flag, so honouring it would defeat the ratio and let a
    // caller force-fill the span queue. The ratio sampler is deterministic per trace id, so a trace is kept or
    // dropped consistently. What this service then sends downstream carries THIS decision, which the engines honour.
    sampler: (() => {
      const local = new TraceIdRatioBasedSampler(config.samplerRatio);
      return new ParentBasedSampler({ root: local, remoteParentSampled: local, remoteParentNotSampled: local });
    })(),
    // Bounded queue, bounded export time: with a dead or hanging collector spans are dropped, never accumulated.
    spanProcessors: [new AllowListSpanProcessor(batchProcessor)],
    metricReaders: [metricReader],
    views: [
      // Our own server-duration histogram carries the route pattern; the instrumentation's would duplicate it.
      { instrumentName: 'http.server.request.duration', aggregation: { type: AggregationType.DROP } },
      { instrumentName: 'http.client.request.duration', attributesProcessors: [createAllowListAttributesProcessor([...METRIC_LABEL_KEYS])] },
    ],
    // W3C trace context only: no baggage, so nothing a caller attaches is forwarded to downstream services.
    textMapPropagator: new W3CTraceContextPropagator(),
    instrumentations: [
      // No orphan client spans (background refreshes etc.): an outbound call is traced only inside a trace.
      new HttpInstrumentation({
        requireParentforOutgoingSpans: true,
        ignoreIncomingRequestHook: (request) => isProbe(request.url),
        // Name the server span by route pattern and tag http.route when the response ends (express has set
        // req.route by then). A client request has no .route, so this leaves outbound spans alone.
        applyCustomAttributesOnSpan: (span, request) => {
          const route = routeTemplate(request as { route?: { path?: unknown } });
          if (route === 'unmatched') return;
          span.setAttribute('http.route', route);
          span.updateName(`${(request as { method?: string }).method ?? 'HTTP'} ${route}`);
        },
      }),
      new UndiciInstrumentation({ requireParentforSpans: true }),
      new NestInstrumentation(),
    ],
  });
  sdk.start();
  setTelemetryActive(true);

  let stopping: Promise<void> | undefined;
  return {
    flush: async () => {
      await Promise.allSettled([batchProcessor.forceFlush(), metricReader.forceFlush()]);
    },
    shutdown: () => {
      stopping ??= new Promise<void>((resolve) => {
        const timer = setTimeout(resolve, config.shutdownTimeoutMs);
        timer.unref();
        sdk
          .shutdown()
          .catch(() => diag.warn('telemetry shutdown did not complete cleanly; buffered data was dropped'))
          .finally(() => {
            clearTimeout(timer);
            setTelemetryActive(false);
            resolve();
          });
      });
      return stopping;
    },
  };
}

/**
 * Flush on SIGTERM/SIGINT, then re-raise the signal. The listener is registered with `once`, so by the
 * time the signal is re-raised no handler of ours remains and the process ends exactly as it would have
 * without telemetry. Bounded by the shutdown timeout.
 */
export function flushOnTermination(handle: TelemetryHandle): void {
  for (const signal of ['SIGTERM', 'SIGINT'] as const) {
    process.once(signal, () => {
      void handle.shutdown().finally(() => process.kill(process.pid, signal));
    });
  }
}
