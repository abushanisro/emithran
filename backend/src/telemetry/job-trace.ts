import { context, propagation, ROOT_CONTEXT, SpanKind, SpanStatusCode, trace } from '@opentelemetry/api';

import { recordJobDuration } from './metrics';
import { isTelemetryActive } from './telemetry-state';

// Carries a trace across a queue. The producer's `traceparent` rides in the job payload (a trace id and a span id:
// no customer data, in keeping with "payloads carry ids only") and the worker continues that trace. a queue row has no
// header field, so the payload is the only transport; the field is stripped before any handler sees the payload.
export const TRACE_FIELD = '__traceparent';

/** The payload with the active trace attached. Unchanged (the same object) when telemetry is off or no trace is active. */
export function withTraceparent<T extends object>(payload: T): T {
  if (!isTelemetryActive()) return payload;
  const carrier: Record<string, string> = {};
  propagation.inject(context.active(), carrier);
  return carrier.traceparent ? { ...payload, [TRACE_FIELD]: carrier.traceparent } : payload;
}

function split<T extends object>(payload: T): { clean: T; traceparent: string | undefined } {
  if (!Object.prototype.hasOwnProperty.call(payload, TRACE_FIELD)) return { clean: payload, traceparent: undefined };
  const { [TRACE_FIELD]: carried, ...clean } = payload as Record<string, unknown>;
  return { clean: clean as T, traceparent: typeof carried === 'string' ? carried : undefined };
}

/**
 * Runs one job attempt. With telemetry off it only strips the trace field. With it on, the attempt is a CONSUMER span
 * `job.<queue>` continuing the producer's trace (a malformed or missing traceparent starts a new trace), and its
 * duration is recorded by queue and outcome. The handler's result and any error pass through untouched.
 */
export function runJob<TPayload extends object, TResult>(
  queue: string,
  payload: TPayload,
  handler: (payload: TPayload) => Promise<TResult>,
): Promise<TResult> {
  const { clean, traceparent } = split(payload);
  if (!isTelemetryActive()) return handler(clean);

  const parent = traceparent ? propagation.extract(ROOT_CONTEXT, { traceparent }) : ROOT_CONTEXT;
  const started = process.hrtime.bigint();
  return trace.getTracer('emithran.backend').startActiveSpan(
    `job.${queue}`,
    { kind: SpanKind.CONSUMER, attributes: { 'emithran.queue': queue } },
    parent,
    async (span) => {
      let outcome: 'ok' | 'error' = 'ok';
      try {
        return await handler(clean);
      } catch (error) {
        outcome = 'error';
        span.recordException(error instanceof Error ? error : new Error('non-error thrown'));
        span.setStatus({ code: SpanStatusCode.ERROR });
        throw error;
      } finally {
        span.setAttribute('emithran.outcome', outcome);
        span.end();
        recordJobDuration(Number(process.hrtime.bigint() - started) / 1e9, queue, outcome);
      }
    },
  );
}
