import { readTelemetryConfig } from './telemetry.config';

describe('readTelemetryConfig', () => {
  it('is off, without a warning, when no endpoint is set (the default for local development and CI)', () => {
    expect(readTelemetryConfig({})).toEqual({ config: null });
    expect(readTelemetryConfig({ OTEL_EXPORTER_OTLP_ENDPOINT: '   ' })).toEqual({ config: null });
  });

  it.each(['not a url', 'ftp://collector:4318', 'collector:4318/'])('turns telemetry off with a warning for a bad endpoint (%s), never throws', (endpoint) => {
    const result = readTelemetryConfig({ OTEL_EXPORTER_OTLP_ENDPOINT: endpoint });
    expect(result.config).toBeNull();
    expect(result.warning).toMatch(/disabled/);
  });

  it('reads a valid endpoint, trims trailing slashes, and defaults the service name and sampling ratio', () => {
    const { config, warning } = readTelemetryConfig({ OTEL_EXPORTER_OTLP_ENDPOINT: 'http://o2.railway.internal:5080/api/default/', NODE_ENV: 'production' });
    expect(warning).toBeUndefined();
    expect(config).toMatchObject({
      endpoint: 'http://o2.railway.internal:5080/api/default',
      serviceName: 'mithran-backend',
      environment: 'production',
      samplerRatio: 0.1,
    });
  });

  it('labels the deployment with APP_ENV (stage, prd) when set, since NODE_ENV is production for both', () => {
    const base = { OTEL_EXPORTER_OTLP_ENDPOINT: 'http://c:4318', NODE_ENV: 'production' };
    expect(readTelemetryConfig({ ...base, APP_ENV: 'stage' }).config?.environment).toBe('stage');
    expect(readTelemetryConfig(base).config?.environment).toBe('production');
  });

  it('sends metrics to <endpoint>/v1/metrics unless OTEL_EXPORTER_OTLP_METRICS_ENDPOINT names another URL', () => {
    const base = { OTEL_EXPORTER_OTLP_ENDPOINT: 'http://o2:5080/api/default/' };
    expect(readTelemetryConfig(base).config?.metricsEndpoint).toBe('http://o2:5080/api/default/v1/metrics');
    const split = readTelemetryConfig({ ...base, OTEL_EXPORTER_OTLP_METRICS_ENDPOINT: 'http://prometheus:9090/api/v1/otlp/v1/metrics' });
    expect(split.config?.metricsEndpoint).toBe('http://prometheus:9090/api/v1/otlp/v1/metrics');
    expect(split.config?.endpoint).toBe('http://o2:5080/api/default');
    const bad = readTelemetryConfig({ ...base, OTEL_EXPORTER_OTLP_METRICS_ENDPOINT: 'prometheus:9090' });
    expect(bad.config).toBeNull();
    expect(bad.warning).toMatch(/METRICS_ENDPOINT.*disabled/);
  });

  it('takes the sampling ratio from OTEL_TRACES_SAMPLER_ARG within 0..1 and rejects anything else', () => {
    const base = { OTEL_EXPORTER_OTLP_ENDPOINT: 'http://c:4318' };
    expect(readTelemetryConfig({ ...base, OTEL_TRACES_SAMPLER_ARG: '0.25' }).config?.samplerRatio).toBe(0.25);
    expect(readTelemetryConfig({ ...base, OTEL_TRACES_SAMPLER_ARG: '0' }).config?.samplerRatio).toBe(0);
    expect(readTelemetryConfig({ ...base, OTEL_TRACES_SAMPLER_ARG: '1' }).config?.samplerRatio).toBe(1);
    for (const bad of ['2', '-0.1', 'abc', 'NaN']) {
      const result = readTelemetryConfig({ ...base, OTEL_TRACES_SAMPLER_ARG: bad });
      expect(result.config).toBeNull();
      expect(result.warning).toMatch(/between 0 and 1/);
    }
  });

  it('keeps the queue, export time and shutdown time bounded (a hanging collector cannot hold the process)', () => {
    const { config } = readTelemetryConfig({ OTEL_EXPORTER_OTLP_ENDPOINT: 'http://c:4318' });
    expect(config!.maxQueueSize).toBeLessThanOrEqual(2048);
    expect(config!.maxExportBatchSize).toBeLessThanOrEqual(config!.maxQueueSize);
    expect(config!.exportTimeoutMs).toBeLessThanOrEqual(5_000);
    expect(config!.shutdownTimeoutMs).toBeLessThanOrEqual(3_000);
  });
});
