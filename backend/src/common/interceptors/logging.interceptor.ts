import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { tap } from 'rxjs/operators';
import { Logger } from '../logger/logger.service';

/** Uptime probes run every few seconds; logging their successes would bury real traffic. Failures are still logged. */
const PROBE_PATHS = new Set(['/api/health', '/ping']);

export const isProbe = (path: string): boolean => PROBE_PATHS.has(path);

export const accessLogLine = (method: string, path: string, status: number, ms: number): string =>
  `${method} ${path} ${status} ${ms}ms`;

/** One access-log line per request, written when it completes. */
@Injectable()
export class LoggingInterceptor implements NestInterceptor {
  constructor(private readonly logger: Logger) {
    this.logger.setContext('HTTP');
  }

  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const request = context.switchToHttp().getRequest();
    const { method } = request;
    // Path only: the query string can carry a session token (?token= for SSE) and must never be logged.
    const url = String(request.originalUrl ?? request.url ?? '').split('?')[0];
    const requestId = request.headers['x-request-id'] || this.generateRequestId();

    request.headers['x-request-id'] = requestId;

    const now = Date.now();

    return next.handle().pipe(
      tap({
        next: () => {
          if (isProbe(url)) return;
          const { statusCode } = context.switchToHttp().getResponse();
          this.logger.log(accessLogLine(method, url, statusCode, Date.now() - now));
        },
        error: (error) => {
          const status = error.status || error.statusCode || 500;
          const logMsg = accessLogLine(method, url, status, Date.now() - now);
          if (status >= 500) {
            this.logger.error(logMsg, error.stack);
          } else if (status === 404 && method === 'GET') {
            // 404 on GET is normal "not found yet" — skip logging
          } else {
            this.logger.warn(logMsg);
          }
        },
      }),
    );
  }

  private generateRequestId(): string {
    return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  }
}
