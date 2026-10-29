// Telemetry configuration, read from the standard OpenTelemetry environment variables.
// Pure: imports nothing from OpenTelemetry, so reading it never loads the SDK.
//
// Telemetry is OFF unless OTEL_EXPORTER_OTLP_ENDPOINT is set. A bad value turns it off with a
// warning rather than stopping the API: monitoring must never decide whether the product starts.

export interface TelemetryConfig {
  /** OTLP/HTTP base URL, no signal path (the exporters append /v1/traces, /v1/metrics). */
  endpoint: string;
  /** Full URL metrics are sent to when it differs from `<endpoint>/v1/metrics` (e.g. Prometheus' OTLP receiver). */
  metricsEndpoint: string;
  serviceName: string;
  environment: string;
  /** Head-sampling ratio for new root traces, 0..1. A parent's decision always wins. */
  samplerRatio: number;
  /** Spans buffered in memory when the exporter is slow or down; beyond this, new spans are dropped. */
  maxQueueSize: number;
  maxExportBatchSize: number;
  scheduledDelayMs: number;
  /** Hard bound on one export attempt, so a hanging collector cannot hold a batch (or shutdown) open. */
  exportTimeoutMs: number;
  metricIntervalMs: number;
  /** Hard bound on flushing at shutdown. */
  shutdownTimeoutMs: number;
}

export interface TelemetryConfigResult {
  config: TelemetryConfig | null;
  /** Set when telemetry was requested but the configuration is unusable. */
  warning?: string;
}

const DEFAULT_SAMPLER_RATIO = 0.1;

export function readTelemetryConfig(env: NodeJS.ProcessEnv = process.env): TelemetryConfigResult {
  const endpoint = env.OTEL_EXPORTER_OTLP_ENDPOINT?.trim();
  if (!endpoint) return { config: null };

  try {
    const url = new URL(endpoint);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error('not http(s)');
  } catch {
    return { config: null, warning: 'OTEL_EXPORTER_OTLP_ENDPOINT is not an http(s) URL; telemetry is disabled.' };
  }

  const rawMetrics = env.OTEL_EXPORTER_OTLP_METRICS_ENDPOINT?.trim();
  let metricsEndpoint = `${endpoint.replace(/\/+$/, '')}/v1/metrics`;
  if (rawMetrics) {
    try {
      const url = new URL(rawMetrics);
      if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error('not http(s)');
      metricsEndpoint = rawMetrics;
    } catch {
      return { config: null, warning: 'OTEL_EXPORTER_OTLP_METRICS_ENDPOINT is not an http(s) URL; telemetry is disabled.' };
    }
  }

  let samplerRatio = DEFAULT_SAMPLER_RATIO;
  const rawRatio = env.OTEL_TRACES_SAMPLER_ARG?.trim();
  if (rawRatio) {
    const parsed = Number(rawRatio);
    if (!Number.isFinite(parsed) || parsed < 0 || parsed > 1) {
      return { config: null, warning: 'OTEL_TRACES_SAMPLER_ARG must be a number between 0 and 1; telemetry is disabled.' };
    }
    samplerRatio = parsed;
  }

  return {
    config: {
      endpoint: endpoint.replace(/\/+$/, ''),
      metricsEndpoint,
      serviceName: env.OTEL_SERVICE_NAME?.trim() || 'mithran-backend',
      environment: env.NODE_ENV || 'development',
      samplerRatio,
      maxQueueSize: 2048,
      maxExportBatchSize: 512,
      scheduledDelayMs: 5_000,
      exportTimeoutMs: 5_000,
      metricIntervalMs: 30_000,
      shutdownTimeoutMs: 3_000,
    },
  };
}
