import { Injectable, LoggerService as NestLoggerService } from '@nestjs/common';
import * as winston from 'winston';
import { currentTraceFields } from '../../telemetry/trace-context';
import { writeErrorToFile } from './error-log-file';

// Adds trace_id/span_id to the entry only while a trace is active. With telemetry off, or outside a
// request, the entry is untouched, so the existing console and file output is unchanged.
const traceCorrelation = winston.format((info) => {
  const fields = currentTraceFields();
  return fields ? Object.assign(info, fields) : info;
});

@Injectable()
export class Logger implements NestLoggerService {
  private logger: winston.Logger;
  private context?: string;

  constructor() {
    this.logger = winston.createLogger({
      level: process.env.LOG_LEVEL || 'info',
      format: winston.format.combine(
        traceCorrelation(),
        winston.format.timestamp(),
        winston.format.errors({ stack: true }),
        winston.format.json(),
      ),
      defaultMeta: { service: 'api-gateway' },
      transports: [
        new winston.transports.Console({
          format: winston.format.combine(
            winston.format.colorize(),
            winston.format.printf(({ timestamp, level, message, context, ...meta }) => {
              const ctx = context ? `[${context}]` : '';
              const metaStr = Object.keys(meta).length ? JSON.stringify(meta) : '';
              return `${timestamp} ${level} ${ctx} ${message} ${metaStr}`;
            }),
          ),
        }),
      ],
    });
  }

  setContext(context: string) {
    this.context = context;
  }

  log(message: string, context?: string) {
    this.logger.info(message, { context: context || this.context });
  }

  // Console for every level; errors are also kept in the error log file.
  error(message: string, trace?: string, context?: string) {
    this.logger.error(message, { trace, context: context || this.context });
    writeErrorToFile(message, context || this.context, trace);
  }

  warn(message: string, context?: string) {
    this.logger.warn(message, { context: context || this.context });
  }

  debug(message: string, context?: string) {
    this.logger.debug(message, { context: context || this.context });
  }

  verbose(message: string, context?: string) {
    this.logger.verbose(message, { context: context || this.context });
  }
}
