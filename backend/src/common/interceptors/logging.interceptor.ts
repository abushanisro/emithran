import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { tap } from 'rxjs/operators';
import { Logger } from '../logger/logger.service';

@Injectable()
export class LoggingInterceptor implements NestInterceptor {
  constructor(private readonly logger: Logger) {
    this.logger.setContext('HTTP');
  }

  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const request = context.switchToHttp().getRequest();
    const { method, url, ip } = request;
    const userAgent = request.get('user-agent') || '';
    const requestId = request.headers['x-request-id'] || this.generateRequestId();

    request.headers['x-request-id'] = requestId;

    const now = Date.now();

    this.logger.log(`→ ${method} ${url} - ${ip} ${userAgent}`);

    return next.handle().pipe(
      tap({
        next: () => {
          const response = context.switchToHttp().getResponse();
          const { statusCode } = response;
          const delay = Date.now() - now;
          this.logger.log(`← ${method} ${url} ${statusCode} - ${delay}ms`);
        },
        error: (error) => {
          const delay = Date.now() - now;
          const status = error.status || error.statusCode || 500;
          const logMsg = `← ${method} ${url} ${status} - ${delay}ms`;
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
