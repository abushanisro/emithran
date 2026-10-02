import { Injectable, NestInterceptor, ExecutionContext, CallHandler } from '@nestjs/common';
import { Observable } from 'rxjs';
import { runWithRequestAuth } from '../request-context/request-auth-context';

/**
 * Opens the per-request auth scope read by SupabaseService.getUserClient().
 *
 * Interceptors run after guards, so request.accessToken / request.user are
 * already set by SupabaseAuthGuard. A request with no token (public route) simply
 * gets no scope, and getUserClient() then rejects: it never degrades to the
 * service-role client.
 *
 * Like RequestCacheInterceptor, the scope is opened around subscribe(): Nest runs
 * the route handler on subscription, after intercept() has returned.
 */
@Injectable()
export class RequestAuthInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const request = context.switchToHttp().getRequest();
    const accessToken: unknown = request?.accessToken;
    const userId: unknown = request?.user?.id;

    if (typeof accessToken !== 'string' || !accessToken || typeof userId !== 'string') {
      return next.handle();
    }

    return new Observable((subscriber) =>
      runWithRequestAuth({ accessToken, userId }, () => next.handle().subscribe(subscriber)),
    );
  }
}
