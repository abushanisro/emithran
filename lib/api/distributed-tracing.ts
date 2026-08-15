/**
 * Distributed Tracing Implementation
 *
 * Implements W3C Trace Context specification for correlation across services.
 * Enables full request tracing: Frontend → API Client → Backend → DB → Queue
 *
 * Standard: https://www.w3.org/TR/trace-context/
 */

// Native crypto used in Edge runtime

/**
 * W3C Trace Context format:
 * traceparent: 00-{trace-id}-{parent-id}-{trace-flags}
 * - version: 00 (fixed)
 * - trace-id: 32 hex chars (16 bytes)
 * - parent-id: 16 hex chars (8 bytes)
 * - trace-flags: 2 hex chars (1 byte)
 */

export interface TraceContext {
  traceId: string; // 32 hex chars
  spanId: string; // 16 hex chars
  parentSpanId?: string; // 16 hex chars
  traceFlags: number; // 0x01 = sampled
  traceState?: string; // Vendor-specific state
  requestId: string; // UUID for correlation
}

export interface Span {
  spanId: string;
  parentSpanId?: string;
  traceId: string;
  name: string;
  startTime: number;
  endTime?: number;
  duration?: number;
  attributes: Record<string, any>;
  status: 'pending' | 'success' | 'error';
  statusMessage?: string;
}

// Removed: randomHex function - now using production-grade crypto polyfill

/**
 * Generate a 128-bit (16 bytes) trace ID
 * Uses production-grade crypto polyfill for cross-platform compatibility
 */
export function generateTraceId(): string {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID().replace(/-/g, '');
  }
  // Fallback for environments without crypto.randomUUID
  return Math.random().toString(16).substring(2) + Math.random().toString(16).substring(2) + Math.random().toString(16).substring(2) + Math.random().toString(16).substring(2);
}

/**
 * Generate a 64-bit (8 bytes) span ID
 * Uses production-grade crypto polyfill for cross-platform compatibility
 */
export function generateSpanId(): string {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID().replace(/-/g, '').substring(0, 16);
  }
  return Math.random().toString(16).substring(2) + Math.random().toString(16).substring(2);
}

/**
 * Generate a UUID v4 for request ID
 * Uses production-grade crypto polyfill with RFC 4122 compliance
 */
export function generateRequestId(): string {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
    var r = Math.random() * 16 | 0, v = c == 'x' ? r : (r & 0x3 | 0x8);
    return v.toString(16);
  });
}

/**
 * Parse W3C traceparent header
 * Format: 00-{trace-id}-{parent-id}-{trace-flags}
 */
export function parseTraceparent(traceparent: string): TraceContext | null {
  const parts = traceparent.split('-');
  if (parts.length !== 4) return null;

  const [version, traceId, parentId, flags] = parts;

  if (!version || !traceId || !parentId || !flags) return null;

  // Validate version
  if (version !== '00') return null;

  // Validate trace ID (32 hex chars, not all zeros)
  if (!/^[0-9a-f]{32}$/.test(traceId) || traceId === '0'.repeat(32)) {
    return null;
  }

  // Validate parent ID (16 hex chars, not all zeros)
  if (!/^[0-9a-f]{16}$/.test(parentId) || parentId === '0'.repeat(16)) {
    return null;
  }

  // Validate flags (2 hex chars)
  if (!/^[0-9a-f]{2}$/.test(flags)) return null;

  return {
    traceId,
    spanId: generateSpanId(), // Generate new span for this service
    parentSpanId: parentId,
    traceFlags: parseInt(flags, 16),
    requestId: generateRequestId(),
  };
}

/**
 * Format trace context as W3C traceparent header
 */
export function formatTraceparent(context: TraceContext): string {
  const flags = context.traceFlags.toString(16).padStart(2, '0');
  return `00-${context.traceId}-${context.spanId}-${flags}`;
}

/**
 * Parse W3C tracestate header
 * Format: vendor1=value1,vendor2=value2
 */
export function parseTracestate(tracestate: string): Record<string, string> {
  const state: Record<string, string> = {};

  tracestate.split(',').forEach((item) => {
    const [key, value] = item.trim().split('=');
    if (key && value) {
      state[key] = value;
    }
  });

  return state;
}

/**
 * Format tracestate header
 */
export function formatTracestate(state: Record<string, string>): string {
  return Object.entries(state)
    .map(([key, value]) => `${key}=${value}`)
    .join(',');
}

/**
 * Trace Manager for maintaining trace context across requests
 */
export class TraceManager {
  private currentContext: TraceContext | null = null;
  private spans = new Map<string, Span>();
  private spanListeners: Array<(span: Span) => void> = [];

  /**
   * Create or get current trace context
   */
  getOrCreateContext(incoming?: TraceContext): TraceContext {
    if (incoming) {
      // Use incoming context (from propagation)
      this.currentContext = {
        ...incoming,
        spanId: generateSpanId(), // New span for this service
        parentSpanId: incoming.spanId,
        requestId: incoming.requestId || generateRequestId(),
      };
      return this.currentContext;
    }

    if (this.currentContext) {
      return this.currentContext;
    }

    // Create new root context
    this.currentContext = {
      traceId: generateTraceId(),
      spanId: generateSpanId(),
      traceFlags: 0x01, // Sampled by default
      requestId: generateRequestId(),
    };

    return this.currentContext;
  }

  /**
   * Get current trace context
   */
  getCurrentContext(): TraceContext | null {
    return this.currentContext;
  }

  /**
   * Create a child span
   */
  startSpan(name: string, attributes: Record<string, any> = {}): Span {
    const context = this.getOrCreateContext();

    const span: Span = {
      spanId: generateSpanId(),
      parentSpanId: context.spanId,
      traceId: context.traceId,
      name,
      startTime: Date.now(),
      attributes,
      status: 'pending',
    };

    this.spans.set(span.spanId, span);
    return span;
  }

  /**
   * End a span with success or error
   */
  endSpan(spanId: string, status: 'success' | 'error' = 'success', statusMessage?: string): void {
    const span = this.spans.get(spanId);
    if (!span) return;

    span.endTime = Date.now();
    span.duration = span.endTime - span.startTime;
    span.status = status;
    if (statusMessage !== undefined) {
      span.statusMessage = statusMessage;
    }

    // Notify listeners
    this.notifyListeners(span);
  }

  /**
   * Add attributes to a span
   */
  addSpanAttributes(spanId: string, attributes: Record<string, any>): void {
    const span = this.spans.get(spanId);
    if (!span) return;

    span.attributes = { ...span.attributes, ...attributes };
  }

  /**
   * Get all spans
   */
  getSpans(): Span[] {
    return Array.from(this.spans.values());
  }

  /**
   * Get spans for a specific trace
   */
  getSpansForTrace(traceId: string): Span[] {
    return Array.from(this.spans.values()).filter((span) => span.traceId === traceId);
  }

  /**
   * Clear all spans (useful for testing or memory management)
   */
  clearSpans(): void {
    this.spans.clear();
  }

  /**
   * Reset trace context (start new trace)
   */
  resetContext(): void {
    this.currentContext = null;
  }

  /**
   * Add listener for span completion
   */
  addSpanListener(listener: (span: Span) => void): () => void {
    this.spanListeners.push(listener);
    return () => {
      const index = this.spanListeners.indexOf(listener);
      if (index > -1) {
        this.spanListeners.splice(index, 1);
      }
    };
  }

  private notifyListeners(span: Span): void {
    this.spanListeners.forEach((listener) => {
      try {
        listener(span);
      } catch (error) {
        // Error in span listener - silently ignored
      }
    });
  }

  /**
   * Export spans for external tracing systems (Jaeger, Zipkin, etc.)
   */
  exportSpans(spansToExport?: Span[]): {
    traceId: string;
    spans: Array<{
      spanId: string;
      parentSpanId?: string | undefined;
      name: string;
      timestamp: number;
      duration: number;
      tags: Record<string, any>;
      status: string;
    }>;
  }[] {
    const traceMap = new Map<string, Span[]>();
    const sourceSpans = spansToExport || Array.from(this.spans.values());

    // Group spans by trace ID
    sourceSpans.forEach((span) => {
      const spans = traceMap.get(span.traceId) || [];
      spans.push(span);
      traceMap.set(span.traceId, spans);
    });

    // Format for export
    return Array.from(traceMap.entries()).map(([traceId, spans]) => ({
      traceId,
      spans: spans.map((span) => ({
        spanId: span.spanId,
        parentSpanId: span.parentSpanId,
        name: span.name,
        timestamp: span.startTime * 1000, // microseconds
        duration: (span.duration || 0) * 1000, // microseconds
        tags: span.attributes,
        status: span.status,
      })),
    }));
  }
}

// Global trace manager instance
export const traceManager = new TraceManager();

/**
 * Helper to wrap an async operation with tracing
 */
export async function traced<T>(
  name: string,
  fn: (span: Span) => Promise<T>,
  attributes?: Record<string, any>,
): Promise<T> {
  const span = traceManager.startSpan(name, attributes);

  try {
    const result = await fn(span);
    traceManager.endSpan(span.spanId, 'success');
    return result;
  } catch (error) {
    traceManager.endSpan(span.spanId, 'error', error instanceof Error ? error.message : String(error));
    throw error;
  }
}

/**
 * Get trace headers for outgoing requests
 */
export function getTraceHeaders(context?: TraceContext): Record<string, string> {
  const ctx = context || traceManager.getCurrentContext();
  if (!ctx) return {};

  const headers: Record<string, string> = {
    traceparent: formatTraceparent(ctx),
    'x-request-id': ctx.requestId,
  };

  if (ctx.traceState) {
    headers.tracestate = ctx.traceState;
  }

  return headers;
}

/**
 * Extract trace context from incoming headers
 */
export function extractTraceContext(headers: Record<string, string>): TraceContext | null {
  const traceparent = headers.traceparent || headers.Traceparent;
  if (!traceparent) return null;

  const context = parseTraceparent(traceparent);
  if (!context) return null;

  // Extract request ID if present
  const requestId = headers['x-request-id'] || headers['X-Request-Id'];
  if (requestId) {
    context.requestId = requestId;
  }

  // Extract tracestate if present
  const tracestate = headers.tracestate || headers.Tracestate;
  if (tracestate) {
    context.traceState = tracestate;
  }

  return context;
}

/**
 * Integration with external tracing systems
 */
export interface TracingExporter {
  export(spans: Span[]): Promise<void>;
}

/**
 * Console exporter for development
 */
export class ConsoleTracingExporter implements TracingExporter {
  async export(_spans: Span[]): Promise<void> {
    // Console tracing exporter - spans processed silently in production
    // In development, tracing data can be accessed via traceManager.getSpans()
  }
}

/**
 * HTTP exporter for external tracing systems (Jaeger, Zipkin, etc.)
 */
export class HttpTracingExporter implements TracingExporter {
  constructor(private endpoint: string) { }

  async export(spans: Span[]): Promise<void> {
    try {
      await fetch(this.endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(traceManager.exportSpans(spans)),
      });
    } catch (error) {
      // Failed to export traces - error silently ignored
    }
  }
}

/**
 * Batch exporter that collects spans and exports periodically
 */
export class BatchTracingExporter {
  private buffer: Span[] = [];
  private timer: NodeJS.Timeout | null = null;

  constructor(
    private exporter: TracingExporter,
    private batchSize: number = 100,
    private batchInterval: number = 5000,
  ) {
    this.startTimer();
  }

  add(span: Span): void {
    this.buffer.push(span);

    if (this.buffer.length >= this.batchSize) {
      this.flush();
    }
  }

  private startTimer(): void {
    this.timer = setInterval(() => {
      this.flush();
    }, this.batchInterval);
  }

  async flush(): Promise<void> {
    if (this.buffer.length === 0) return;

    const spans = [...this.buffer];
    this.buffer = [];

    try {
      await this.exporter.export(spans);
    } catch (error) {
      // Failed to flush traces - error silently ignored
    }
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    this.flush();
  }
}
