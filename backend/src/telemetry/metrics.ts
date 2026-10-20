import { metrics, type Attributes } from '@opentelemetry/api';

// Every metric this service records itself. Labels are closed sets by construction (the types
// below), never a value read from a request: no user id, item id, request id, filename or free
// text. The SDK view in start.ts additionally restricts what third-party instruments may label.

export const METRIC_LABEL_KEYS = [
  'http.request.method',
  'http.route',
  'emithran.status_class',
  'emithran.operation',
  'emithran.outcome',
  // Set by the HTTP client instrumentation (outbound calls to Supabase, the engines, FX).
  'server.address',
  'http.response.status_code',
  'error.type',
  'network.protocol.version',
  'url.scheme',
] as const;

export type StatusClass = '1xx' | '2xx' | '3xx' | '4xx' | '5xx' | 'aborted';
export type CostingOperation = 'cost_summary' | 'route_comparison';
export type Outcome = 'ok' | 'error';

const SCOPE = 'emithran.backend';

// Instruments are created on first use, after the SDK has installed its MeterProvider
// (before that, metrics.getMeter() returns a no-op that would never be replaced).
let instruments: ReturnType<typeof createInstruments> | undefined;

function createInstruments() {
  const meter = metrics.getMeter(SCOPE);
  return {
    httpServerDuration: meter.createHistogram('emithran.http.server.duration', {
      unit: 's',
      description: 'Inbound HTTP request duration by route template, method and status class',
    }),
    costingDuration: meter.createHistogram('emithran.costing.duration', {
      unit: 's',
      description: 'Duration of the costing paths (cost summary, route comparison)',
    }),
  };
}

const get = () => (instruments ??= createInstruments());

/** Test hook: drop cached instruments so a new MeterProvider is picked up. */
export function resetMetricInstruments(): void {
  instruments = undefined;
}

export function statusClassOf(statusCode: number): StatusClass {
  if (statusCode >= 500) return '5xx';
  if (statusCode >= 400) return '4xx';
  if (statusCode >= 300) return '3xx';
  if (statusCode >= 200) return '2xx';
  return '1xx';
}

const KNOWN_METHODS = new Set(['GET', 'HEAD', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS']);

export function recordHttpServerDuration(seconds: number, method: string, route: string, statusClass: StatusClass): void {
  // A client can send any method token; anything outside the standard set shares one label value.
  const attributes: Attributes = {
    'http.request.method': KNOWN_METHODS.has(method) ? method : '_OTHER',
    'http.route': route,
    'emithran.status_class': statusClass,
  };
  get().httpServerDuration.record(seconds, attributes);
}

export function recordCostingDuration(seconds: number, operation: CostingOperation, outcome: Outcome): void {
  get().costingDuration.record(seconds, { 'emithran.operation': operation, 'emithran.outcome': outcome });
}
