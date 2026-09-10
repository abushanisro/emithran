import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { runWithRequestCache } from '../../modules/bom-items/costing/shared/core/request-cache';

/**
 * Gives every request a read cache for the duration of that request.
 *
 * Lives here, at the framework boundary, because request scoping is a
 * cross-cutting concern. The alternative -- establishing the scope inside the
 * services that benefit -- means every such method needs a wrapper and a
 * duplicated parameter list, and the scope then covers only the methods someone
 * remembered to wrap.
 *
 * The scope is established around `subscribe()`, not around `intercept()`.
 * Nest invokes the route handler when the returned Observable is subscribed to,
 * which happens after `intercept()` has already returned; establishing the
 * AsyncLocalStorage context around `next.handle()` alone would therefore leave
 * the handler running outside it.
 *
 * What is actually cached, and the constraint on adding more, is documented in
 * request-cache.ts. This interceptor only opens the scope -- it never decides
 * what goes in it.
 */
@Injectable()
export class RequestCacheInterceptor implements NestInterceptor {
  intercept(_context: ExecutionContext, next: CallHandler): Observable<unknown> {
    return new Observable((subscriber) =>
      runWithRequestCache(() => next.handle().subscribe(subscriber)),
    );
  }
}
