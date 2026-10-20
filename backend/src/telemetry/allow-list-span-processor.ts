import type { Context } from '@opentelemetry/api';
import type { ReadableSpan, SpanProcessor } from '@opentelemetry/sdk-trace';

type Span = Parameters<SpanProcessor['onStart']>[0];

// What may leave the process on a span. Everything else is deleted before export, so a
// future instrumentation upgrade that starts recording a new attribute (a URL with its query
// string, a header, a database statement) cannot leak by default. Deliberately an allow-list:
// the unsafe set (customer data, tokens, filenames, BOM contents) is open-ended.
const ALLOWED_ATTRIBUTES = new Set([
  'http.request.method',
  'http.method',
  'http.route',
  'http.response.status_code',
  'http.status_code',
  'url.scheme',
  'http.scheme',
  'server.address',
  'server.port',
  'net.peer.name',
  'net.peer.port',
  'network.protocol.version',
  'http.flavor',
  'error.type',
  'component',
]);
const ALLOWED_PREFIXES = ['emithran.', 'nestjs.'];

// Exception events keep only the class of error. The message and stack can embed values from the
// failing query or file; the full stack is in the application log, correlated by trace id.
const ALLOWED_EVENT_ATTRIBUTES = new Set(['exception.type']);

export function isAllowedSpanAttribute(key: string): boolean {
  return ALLOWED_ATTRIBUTES.has(key) || ALLOWED_PREFIXES.some((prefix) => key.startsWith(prefix));
}

function prune(attributes: Record<string, unknown> | undefined, allowed: (key: string) => boolean): void {
  if (!attributes) return;
  for (const key of Object.keys(attributes)) {
    if (!allowed(key)) delete attributes[key];
  }
}

export class AllowListSpanProcessor implements SpanProcessor {
  constructor(private readonly next: SpanProcessor) {}

  onStart(span: Span, parentContext: Context): void {
    this.next.onStart(span, parentContext);
  }

  onEnd(span: ReadableSpan): void {
    try {
      prune(span.attributes as Record<string, unknown>, isAllowedSpanAttribute);
      for (const event of span.events) {
        prune(event.attributes as Record<string, unknown> | undefined, (key) => ALLOWED_EVENT_ATTRIBUTES.has(key));
      }
      // A span name must never carry a query string.
      const queryAt = span.name.indexOf('?');
      if (queryAt >= 0) (span as { name: string }).name = span.name.slice(0, queryAt);
    } catch {
      // A span that could not be sanitised is dropped, never exported as-is, and never throws into the request.
      return;
    }
    this.next.onEnd(span);
  }

  forceFlush(): Promise<void> {
    return this.next.forceFlush();
  }

  shutdown(): Promise<void> {
    return this.next.shutdown();
  }
}
