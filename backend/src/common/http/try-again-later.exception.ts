import { HttpException, type HttpStatus } from '@nestjs/common';

/**
 * A refusal the caller should retry after a pause: 429 when the caller (or its organization) is at its own share, 503 when the
 * whole server is at capacity. GlobalExceptionFilter sends retryAfterSeconds as the Retry-After header.
 */
export class TryAgainLaterException extends HttpException {
  constructor(
    status: HttpStatus.TOO_MANY_REQUESTS | HttpStatus.SERVICE_UNAVAILABLE,
    message: string,
    readonly retryAfterSeconds: number,
  ) {
    super(message, status);
  }
}
