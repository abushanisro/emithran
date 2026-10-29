import { Injectable, NestInterceptor, ExecutionContext, CallHandler } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { Observable } from 'rxjs';
import { clientIp } from '../client-ip';
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

    const organizationId: unknown = request?.organizationId;
    const incomingId: unknown = request?.headers?.['x-request-id'];
    const auth = {
      accessToken,
      userId,
      ...(typeof organizationId === 'string' && organizationId ? { organizationId } : {}),
      ip: clientIp(request),
      requestId: typeof incomingId === 'string' && incomingId ? incomingId.slice(0, 64) : randomUUID(),
    };

    return new Observable((subscriber) => runWithRequestAuth(auth, () => next.handle().subscribe(subscriber)));
  }
}
