/**
 * Distributed Tracing & Correlation ID System
 *
 * Production-grade request tracing that enables:
 * - End-to-end request tracking (Frontend → API → Database)
 * - Incident debugging and root cause analysis
 * - Performance monitoring across services
 * - OpenTelemetry-compatible trace/span IDs
 *
 * Industry Standards:
 * - W3C Trace Context (traceparent, tracestate)
 * - OpenTelemetry specification compliance
 * - RFC-compliant correlation ID format
 */

import { isProduction } from '../config';

/**
 * W3C Trace Context format
 * traceparent: 00-{trace-id}-{span-id}-{flags}
 */
export interface TraceContext {
  traceId: string;        // 32 hex chars (128 bits)
  spanId: string;         // 16 hex chars (64 bits)
  parentSpanId?: string;  // 16 hex chars (64 bits)
  flags: string;          // 2 hex chars (8 bits)
  traceState?: string;    // Vendor-specific data
}

/**
 * Request correlation context
 */
export interface CorrelationContext {
  correlationId: string;  // UUID v4 format
  requestId: string;      // Short alphanumeric ID
  sessionId?: string;     // User session ID
  userId?: string;        // User ID (hashed in production)
  trace: TraceContext;
}

/**
 * Generate cryptographically secure random hex string
 */
function generateSecureHex(length: number): string {
  const bytes = new Uint8Array(length / 2);
  crypto.getRandomValues(bytes);
  return Array.from(bytes)
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}

/**
 * Generate UUID v4
 */
function generateUUID(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);

  // Set version (4) and variant bits
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x40; // Version 4
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80; // Variant 10

  const hex = Array.from(bytes)
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');

  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20, 32)
  ].join('-');
}

/**
 * Generate short alphanumeric request ID (8 chars)
 */
function generateRequestId(): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let result = '';
  const bytes = new Uint8Array(8);
  crypto.getRandomValues(bytes);

  for (let i = 0; i < 8; i++) {
    result += chars[(bytes[i] ?? 0) % chars.length] ?? '';
  }

  return result;
}

/**
 * Create new trace context
 */
export function createTraceContext(parentSpanId?: string): TraceContext {
  return {
    traceId: generateSecureHex(32),     // 128-bit trace ID
    spanId: generateSecureHex(16),      // 64-bit span ID
    ...(parentSpanId !== undefined ? { parentSpanId } : {}),
    flags: '01',                        // Sampled flag
    traceState: `mithran=${Date.now()}` // Custom trace state
  };
}

/**
 * Parse W3C traceparent header
 */
export function parseTraceparent(traceparent: string): TraceContext | null {
  const parts = traceparent.split('-');
  if (parts.length !== 4 || parts[0] !== '00') {
    return null; // Invalid format
  }

  const [, traceId, spanId, flags] = parts;

  if (!traceId || !spanId || !flags) {
    return null;
  }

  // Validate format
  if (traceId.length !== 32 || spanId.length !== 16 || flags.length !== 2) {
    return null;
  }

  return {
    traceId,
    spanId,
    parentSpanId: spanId, // Current span becomes parent for children
    flags
  };
}

/**
 * Format trace context as W3C traceparent header
 */
export function formatTraceparent(trace: TraceContext): string {
  return `00-${trace.traceId}-${trace.spanId}-${trace.flags}`;
}

/**
 * Create child span from parent trace
 */
export function createChildSpan(parentTrace: TraceContext): TraceContext {
  return {
    ...parentTrace,
    spanId: generateSecureHex(16),      // New span ID
    parentSpanId: parentTrace.spanId,   // Parent span ID
  };
}

/**
 * Global correlation context manager
 */
class CorrelationManager {
  private context: CorrelationContext | null = null;

  /**
   * Initialize new correlation context
   */
  initialize(options?: {
    traceparent?: string;
    sessionId?: string;
    userId?: string;
  }): CorrelationContext {
    const { traceparent, sessionId, userId } = options || {};

    // Parse existing trace context or create new one
    const trace = traceparent
      ? parseTraceparent(traceparent) || createTraceContext()
      : createTraceContext();

    const resolvedUserId = userId && isProduction ? this.hashUserId(userId) : userId;

    const ctx: CorrelationContext = {
      correlationId: generateUUID(),
      requestId: generateRequestId(),
      ...(sessionId !== undefined ? { sessionId } : {}),
      ...(resolvedUserId !== undefined ? { userId: resolvedUserId } : {}),
      trace
    };

    this.context = ctx;
    return ctx;
  }

  /**
   * Get current correlation context
   */
  get(): CorrelationContext | null {
    return this.context;
  }

  /**
   * Create child context for sub-requests
   */
  createChild(): CorrelationContext {
    if (!this.context) {
      throw new Error('No correlation context initialized');
    }

    return {
      ...this.context,
      requestId: generateRequestId(),     // New request ID for sub-request
      trace: createChildSpan(this.context.trace)
    };
  }

  /**
   * Get correlation headers for HTTP requests
   */
  getHeaders(): Record<string, string> {
    if (!this.context) {
      return {};
    }

    return {
      'traceparent': formatTraceparent(this.context.trace),
      'x-correlation-id': this.context.correlationId,
      'x-request-id': this.context.requestId,
      ...(this.context.sessionId && { 'x-session-id': this.context.sessionId }),
      ...(this.context.userId && { 'x-user-id': this.context.userId }),
      ...(this.context.trace.traceState && { 'tracestate': this.context.trace.traceState })
    };
  }

  /**
   * Get structured log metadata
   */
  getLogMetadata(): Record<string, any> {
    if (!this.context) {
      return {};
    }

    return {
      correlationId: this.context.correlationId,
      requestId: this.context.requestId,
      traceId: this.context.trace.traceId,
      spanId: this.context.trace.spanId,
      parentSpanId: this.context.trace.parentSpanId,
      sessionId: this.context.sessionId,
      userId: this.context.userId
    };
  }

  /**
   * Hash user ID for production security
   */
  private hashUserId(userId: string): string {
    // Simple hash for user ID obfuscation
    let hash = 0;
    for (let i = 0; i < userId.length; i++) {
      const char = userId.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash;
    }
    return `user_${Math.abs(hash).toString(16)}`;
  }
}

/**
 * Global correlation manager instance
 */
export const correlationManager = new CorrelationManager();

/**
 * Express.js middleware for correlation ID
 */
export function correlationMiddleware() {
  return (req: any, res: any, next: any) => {
    // Extract existing trace headers
    const traceparent = req.headers.traceparent;
    const sessionId = req.headers['x-session-id'];
    const userId = req.headers['x-user-id'];

    // Initialize correlation context
    const context = correlationManager.initialize({
      traceparent,
      sessionId,
      userId
    });

    // Add to request for access in controllers
    req.correlationContext = context;

    // Add response headers for client tracking
    const headers = correlationManager.getHeaders();
    Object.entries(headers).forEach(([key, value]) => {
      res.setHeader(key, value);
    });

    next();
  };
}

/**
 * Request wrapper that automatically adds correlation headers
 */
export function withCorrelation<T extends (...args: any[]) => Promise<any>>(
  requestFn: T
): T {
  return (async (...args: any[]) => {
    const headers = correlationManager.getHeaders();

    // Merge correlation headers with existing request headers
    if (args[0] && typeof args[0] === 'object') {
      args[0].headers = {
        ...args[0].headers,
        ...headers
      };
    }

    return await requestFn(...args);
  }) as T;
}

/**
 * Performance timing utilities
 */
export class PerformanceTracer {
  private startTime: number;

  constructor(_operationName: string) {
    this.startTime = performance.now();
    correlationManager.get() || correlationManager.initialize();
  }

  /**
   * End trace and return performance metrics
   */
  end(operationName: string): {
    duration: number;
    metadata: Record<string, any>;
  } {
    const duration = performance.now() - this.startTime;

    return {
      duration,
      metadata: {
        operation: operationName,
        duration: `${duration.toFixed(2)}ms`,
        ...correlationManager.getLogMetadata()
      }
    };
  }
}

/**
 * Trace async operation with correlation context
 */
export async function traceOperation<T>(
  operationName: string,
  operation: () => Promise<T>,
  _metadata?: Record<string, any>
): Promise<T> {
  const tracer = new PerformanceTracer(operationName);

  try {
    const result = await operation();
    tracer.end(operationName);
    return result;
  } catch (error) {
    tracer.end(operationName);
    throw error;
  }
}

/**
 * Initialize correlation context from request headers (for client-side)
 */
export function initializeFromHeaders(headers: Headers): CorrelationContext {
  const traceparent = headers.get('traceparent') ?? undefined;
  const sessionId = headers.get('x-session-id') ?? undefined;
  const userId = headers.get('x-user-id') ?? undefined;
  return correlationManager.initialize({
    ...(traceparent !== undefined ? { traceparent } : {}),
    ...(sessionId !== undefined ? { sessionId } : {}),
    ...(userId !== undefined ? { userId } : {}),
  });
}

/**
 * Generate new correlation context for new requests
 */
export function generateCorrelationContext(options?: {
  sessionId?: string;
  userId?: string;
}): CorrelationContext {
  return correlationManager.initialize(options);
}
