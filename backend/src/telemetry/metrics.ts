import { metrics, type Attributes } from '@opentelemetry/api';

import { withTimeout } from '../common/async/with-timeout';

// Every metric this service records itself. Labels are closed sets by construction (the types
// below), never a value read from a request: no user id, item id, request id, filename or free
// text. The SDK view in start.ts additionally restricts what third-party instruments may label.

export const METRIC_LABEL_KEYS = [
  'http.request.method',
  'http.route',
  'emithran.status_class',
  'emithran.operation',
  'emithran.outcome',
  'emithran.queue',
  // Set by the HTTP client instrumentation (outbound calls to PostgREST, the engines, FX).
  'server.address',
  'http.response.status_code',
  'error.type',
  'network.protocol.version',
  'url.scheme',
] as const;

export type StatusClass = '1xx' | '2xx' | '3xx' | '4xx' | '5xx' | 'aborted';
export type CostingOperation = 'cost_summary' | 'route_comparison';
export type Outcome = 'ok' | 'error';
/** `retry`: the attempt failed but the upload goes back in the queue, so it is not terminal. */
export type CadUploadOutcome = Outcome | 'retry';

const SCOPE = 'emithran.backend';

// Explicit bucket bounds (seconds), sized to what each path really takes: an API call is milliseconds to seconds, a
// costing run up to minutes, a CAD upload up to the 10-minute engine timeout plus item creation.
const HTTP_BUCKETS = [0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10, 30];
const COSTING_BUCKETS = [0.1, 0.5, 1, 2.5, 5, 10, 30, 60, 120, 300];
const JOB_BUCKETS = [1, 5, 10, 30, 60, 120, 300, 600, 1800];

// Instruments are created on first use, after the SDK has installed its MeterProvider
// (before that, metrics.getMeter() returns a no-op that would never be replaced).
let instruments: ReturnType<typeof createInstruments> | undefined;
let queueDepthRegistered = false;

function createInstruments() {
  const meter = metrics.getMeter(SCOPE);
  return {
    httpServerDuration: meter.createHistogram('emithran.http.server.duration', {
      unit: 's',
      description: 'Inbound HTTP request duration by route template, method and status class',
      advice: { explicitBucketBoundaries: HTTP_BUCKETS },
    }),
    httpActive: meter.createUpDownCounter('emithran.http.server.active_requests', {
      unit: '{request}',
      description: 'Inbound HTTP requests currently being handled',
    }),
    costingDuration: meter.createHistogram('emithran.costing.duration', {
      unit: 's',
      description: 'Duration of the costing paths (cost summary, route comparison)',
      advice: { explicitBucketBoundaries: COSTING_BUCKETS },
    }),
    jobDuration: meter.createHistogram('emithran.job.duration', {
      unit: 's',
      description: 'Duration of one background job attempt by queue and outcome',
      advice: { explicitBucketBoundaries: JOB_BUCKETS },
    }),
    cadUploadDuration: meter.createHistogram('emithran.cad_upload.duration', {
      unit: 's',
      description: 'Duration of one CAD upload processing attempt (STEP/ZIP to BOM items) by outcome',
      advice: { explicitBucketBoundaries: JOB_BUCKETS },
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

export function recordJobDuration(seconds: number, queue: string, outcome: Outcome): void {
  get().jobDuration.record(seconds, { 'emithran.queue': queue, 'emithran.outcome': outcome });
}

/** +1 when a request starts, -1 when it closes; no labels, so it cannot carry request data. */
export function addActiveHttpRequests(delta: 1 | -1): void {
  get().httpActive.add(delta);
}

export function recordCadUploadDuration(seconds: number, outcome: CadUploadOutcome): void {
  get().cadUploadDuration.record(seconds, { 'emithran.outcome': outcome });
}

const DEPTH_READ_TIMEOUT_MS = 2_000;

// The gauge and its callback are registered once per process. Each queue name has one reader (the last registered wins for
// that name), so several producers (electronics jobs, CAD uploads) can report through the same gauge.
const depthReaders = new Map<string, (queue: string) => Promise<number | null>>();

/**
 * Reports the number of jobs waiting per queue, read when metrics are collected (every export interval), not per job.
 * `queues` is a closed list supplied by the caller, so the label cannot carry request data. A read that fails or is
 * slow is skipped for that interval: collection never waits long, never throws, and never blocks a request.
 */
export function observeQueueDepth(queues: readonly string[], read: (queue: string) => Promise<number | null>): void {
  for (const queue of queues) depthReaders.set(queue, read);
  if (queueDepthRegistered) return;
  queueDepthRegistered = true;
  const gauge = metrics.getMeter(SCOPE).createObservableGauge('emithran.job.queue.depth', {
    description: 'Background jobs waiting to run, by queue',
  });
  gauge.addCallback(async (result) => {
    await Promise.all(
      [...depthReaders].map(async ([queue, read]) => {
        try {
          const depth = await withTimeout(read(queue), DEPTH_READ_TIMEOUT_MS, 'queue depth');
          if (depth !== null) result.observe(depth, { 'emithran.queue': queue });
        } catch {
          // skip this queue for this interval
        }
      }),
    );
  });
}
