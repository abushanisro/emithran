import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';
import { createdLocation } from '../http/created-location';

export interface Response<T> {
  success: boolean;
  data: T;
  message?: string;
  metadata: {
    timestamp: string;
    requestId?: string;
  };
}

@Injectable()
export class TransformInterceptor<T>
  implements NestInterceptor<T, Response<T>>
{
  intercept(
    context: ExecutionContext,
    next: CallHandler,
  ): Observable<Response<T>> {
    const http = context.switchToHttp();
    const request = http.getRequest();
    const requestId = request.headers['x-request-id'];

    return next.handle().pipe(
      map((data) => {
        const body = this.transformKeys(data);
        const location = createdLocation(context.getHandler(), String(request.originalUrl ?? request.url ?? ''), body);
        if (location) http.getResponse().setHeader('Location', location);
        return {
          success: true,
          data: body,
          metadata: {
            timestamp: new Date().toISOString(),
            requestId,
          },
        };
      }),
    );
  }

  /**
   * Recursively transform all snake_case keys to camelCase
   */
  private transformKeys(obj: any): any {
    if (obj === null || obj === undefined) {
      return obj;
    }

    if (Array.isArray(obj)) {
      return obj.map((item) => this.transformKeys(item));
    }

    if (typeof obj === 'object' && obj.constructor === Object) {
      const transformed: any = {};
      for (const key in obj) {
        if (obj.hasOwnProperty(key)) {
          const camelKey = this.snakeToCamel(key);
          transformed[camelKey] = this.transformKeys(obj[key]);
        }
      }
      return transformed;
    }

    return obj;
  }

  /**
   * Convert snake_case to camelCase
   */
  private snakeToCamel(str: string): string {
    return str.replace(/_([a-z])/g, (_, letter) => letter.toUpperCase());
  }
}
