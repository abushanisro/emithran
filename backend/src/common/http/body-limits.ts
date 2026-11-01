import type { NestExpressApplication } from '@nestjs/platform-express';

/**
 * The largest JSON or form body any route accepts. Body parsing is Express middleware, so it runs before the auth guard and the
 * rate limiter: whatever this allows, an anonymous caller can make the process buffer and parse. No route needs more: the largest
 * JSON bodies (copilot chat at 8 x 8000 chars, bulk LHR rows, VAVE idea batches) are well under it, and files come as multipart
 * uploads with their own per-route limits. A larger body is refused with 413 before it is read.
 */
export const MAX_JSON_BODY = '1mb';

/** Installs the only JSON and urlencoded parsers. The app must be created with `bodyParser: false` so Nest adds no others. */
export function configureBodyParsers(app: NestExpressApplication): void {
  app.useBodyParser('json', { limit: MAX_JSON_BODY });
  app.useBodyParser('urlencoded', { limit: MAX_JSON_BODY, extended: true });
}
