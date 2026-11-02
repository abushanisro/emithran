import { Inject, Injectable, type CallHandler, type ExecutionContext, type NestInterceptor } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ThrottlerException, ThrottlerStorage } from '@nestjs/throttler';
import { from, Observable, switchMap } from 'rxjs';

import { orgThrottleOptions } from './throttlers';

import type { Response } from 'express';

/**
 * The per-organization limit (throttlers.ts orgThrottleOptions), next to ClientIpThrottlerGuard's per-user one and in the same
 * storage. It is an interceptor because the organization is known only after OrganizationContextGuard has resolved it for the
 * route (request.organizationId), and every guard, including the global rate limiter, runs before that guard. A route that
 * resolves no organization is left to the per-user limit.
 */
@Injectable()
export class OrgThrottleInterceptor implements NestInterceptor {
  private readonly options: { limit: number; ttl: number };

  constructor(
    @Inject(ThrottlerStorage) private readonly storage: ThrottlerStorage,
    config: ConfigService,
  ) {
    this.options = orgThrottleOptions((name, fallback) => config.get<number>(name, fallback));
  }

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const http = context.switchToHttp();
    const { organizationId } = http.getRequest<{ organizationId?: unknown }>();
    if (typeof organizationId !== 'string' || !organizationId) return next.handle();
    return from(this.storage.increment(`org-throttle:${organizationId}`, this.options.ttl)).pipe(
      switchMap(({ totalHits, timeToExpire }) => {
        if (totalHits > this.options.limit) {
          http.getResponse<Response>().setHeader('Retry-After', String(timeToExpire));
          throw new ThrottlerException('Your organization is sending too many requests. Try again shortly.');
        }
        return next.handle();
      }),
    );
  }
}
