import { SpanStatusCode, trace } from '@opentelemetry/api';

import { recordCostingDuration, type CostingOperation } from './metrics';
import { isTelemetryActive } from './telemetry-state';

/**
 * Wraps an async method in a span named `costing.<operation>` and records its duration.
 * `operation` is a closed union, so the span name and the metric label can never carry request data.
 *
 * With telemetry off the original method is called directly and its own promise is returned:
 * the wrapper adds no await, no extra promise and no behaviour. With it on, the result and any
 * error pass through untouched; only a span and a duration are added around them.
 */
export function Traced(operation: CostingOperation): MethodDecorator {
  return (_target, _key, descriptor) => {
    const original = descriptor.value as unknown as (...args: unknown[]) => Promise<unknown>;
    const wrapped = function (this: unknown, ...args: unknown[]): Promise<unknown> {
      if (!isTelemetryActive()) return original.apply(this, args);

      const started = process.hrtime.bigint();
      return trace.getTracer('emithran.backend').startActiveSpan(
        `costing.${operation}`,
        { attributes: { 'emithran.operation': operation } },
        async (span) => {
          let outcome: 'ok' | 'error' = 'ok';
          try {
            return await original.apply(this, args);
          } catch (error) {
            outcome = 'error';
            span.recordException(error instanceof Error ? error : new Error('non-error thrown'));
            span.setStatus({ code: SpanStatusCode.ERROR });
            throw error;
          } finally {
            span.setAttribute('emithran.outcome', outcome);
            span.end();
            recordCostingDuration(Number(process.hrtime.bigint() - started) / 1e9, operation, outcome);
          }
        },
      );
    };
    descriptor.value = wrapped as unknown as typeof descriptor.value;
  };
}
