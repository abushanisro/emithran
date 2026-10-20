import { ConsoleLogger, type LogLevel } from '@nestjs/common';

import { currentTraceFields } from './trace-context';

// Nest's own ConsoleLogger (what the 80 `new Logger(Name)` call sites write through) with the
// active trace appended to each line. Outside a traced request the line is byte-identical to
// the stock logger's. Only used when telemetry is enabled (main.ts), so with it off the stock
// logger runs unchanged.
export class CorrelatedConsoleLogger extends ConsoleLogger {
  protected override formatMessage(
    logLevel: LogLevel,
    message: unknown,
    pidMessage: string,
    formattedLogLevel: string,
    contextMessage: string,
    timestampDiff: string,
  ): string {
    const line = super.formatMessage(logLevel, message, pidMessage, formattedLogLevel, contextMessage, timestampDiff);
    const fields = currentTraceFields();
    if (!fields) return line;
    // The stock line ends with "\n"; the correlation goes before it.
    return `${line.slice(0, -1)} trace_id=${fields.trace_id} span_id=${fields.span_id}\n`;
  }
}
