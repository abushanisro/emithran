import { isSpanContextValid, trace } from '@opentelemetry/api';

export interface TraceFields {
  trace_id: string;
  span_id: string;
}

// The active span's ids, for log correlation. Uses only @opentelemetry/api, which is a no-op
// until the SDK is started: with telemetry off this always returns undefined and costs a
// single function call per log line.
export function currentTraceFields(): TraceFields | undefined {
  const context = trace.getActiveSpan()?.spanContext();
  if (!context || !isSpanContextValid(context)) return undefined;
  return { trace_id: context.traceId, span_id: context.spanId };
}
