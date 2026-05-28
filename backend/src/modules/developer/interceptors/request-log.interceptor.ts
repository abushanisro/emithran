import { Injectable, NestInterceptor, ExecutionContext, CallHandler } from '@nestjs/common';
import { Observable } from 'rxjs';
import { tap } from 'rxjs/operators';
import { RequestLogsService } from '../services/request-logs.service';

@Injectable()
export class RequestLogInterceptor implements NestInterceptor {
  constructor(private readonly requestLogsService: RequestLogsService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const req = context.switchToHttp().getRequest();

    // Skip logging the logs endpoints themselves to prevent infinite loops
    if (req.path?.includes('/developer/logs') || req.path?.includes('/health')) {
      return next.handle();
    }

    const start = Date.now();
    const userId: string | null = req.user?.id ?? null;
    const method: string = req.method ?? 'GET';
    const path: string = req.path ?? '';

    return next.handle().pipe(
      tap({
        next: () => {
          const statusCode = context.switchToHttp().getResponse().statusCode ?? 200;
          // Fire-and-forget: do not await
          void this.requestLogsService.write({
            userId,
            method,
            path,
            statusCode,
            durationMs: Date.now() - start,
          });
        },
        error: (err) => {
          const statusCode = err?.status ?? err?.statusCode ?? 500;
          void this.requestLogsService.write({
            userId,
            method,
            path,
            statusCode,
            durationMs: Date.now() - start,
            errorCode: err?.code ?? null,
          });
        },
      }),
    );
  }
}
