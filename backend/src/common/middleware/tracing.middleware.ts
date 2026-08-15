/**
 * Distributed Tracing Middleware for NestJS
 * 
 * Implements W3C Trace Context standard for request correlation:
 * - Extracts or generates correlation IDs
 * - Propagates trace context across services
 * - Adds tracing headers to responses
 * - Provides request-scoped correlation context
 */

import { Injectable, NestMiddleware, Logger } from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';
import { randomBytes } from 'crypto';

/**
 * W3C Trace Context format
 */
interface TraceContext {
  traceId: string;        // 32 hex chars (128 bits)
  spanId: string;         // 16 hex chars (64 bits)
  parentSpanId?: string;  // 16 hex chars (64 bits)
  flags: string;          // 2 hex chars (8 bits)
}

/**
 * Request correlation context
 */
interface CorrelationContext {
  correlationId: string;
  requestId: string;
  sessionId?: string;
  userId?: string;
  trace: TraceContext;
  startTime: number;
}

/**
 * Extended request interface with correlation context
 */
interface RequestWithCorrelation extends Request {
  correlationContext?: CorrelationContext;
}

@Injectable()
export class TracingMiddleware implements NestMiddleware {
  private readonly logger = new Logger(TracingMiddleware.name);

  use(req: RequestWithCorrelation, res: Response, next: NextFunction) {
    const startTime = Date.now();

    try {
      // Extract existing trace context from headers
      const traceparent = req.headers.traceparent as string;
      const correlationId = req.headers['x-correlation-id'] as string;
      const sessionId = req.headers['x-session-id'] as string;
      const userId = req.headers['x-user-id'] as string;

      // Parse or generate trace context
      const trace = this.parseOrGenerateTrace(traceparent);
      
      // Create correlation context
      const context: CorrelationContext = {
        correlationId: correlationId || this.generateUUID(),
        requestId: this.generateRequestId(),
        sessionId,
        userId,
        trace,
        startTime
      };

      // Attach to request for access in controllers/services
      req.correlationContext = context;

      // Add tracing headers to response
      this.addResponseHeaders(res, context);

      // Log request with correlation context (production-safe)
      this.logRequest(req, context);

      // Handle response completion
      res.on('finish', () => {
        this.logResponse(req, res, context);
      });

      next();
    } catch (error) {
      this.logger.error('Tracing middleware error', error);
      next(); // Continue even if tracing fails
    }
  }

  /**
   * Parse existing traceparent header or generate new trace context
   */
  private parseOrGenerateTrace(traceparent?: string): TraceContext {
    if (traceparent) {
      const parsed = this.parseTraceparent(traceparent);
      if (parsed) {
        // Create child span from parent trace
        return {
          ...parsed,
          spanId: this.generateHex(16),
          parentSpanId: parsed.spanId
        };
      }
    }

    // Generate new trace context
    return {
      traceId: this.generateHex(32),
      spanId: this.generateHex(16),
      flags: '01' // Sampled
    };
  }

  /**
   * Parse W3C traceparent header
   */
  private parseTraceparent(traceparent: string): TraceContext | null {
    const parts = traceparent.split('-');
    if (parts.length !== 4 || parts[0] !== '00') {
      return null;
    }

    const [, traceId, spanId, flags] = parts;
    
    if (traceId.length !== 32 || spanId.length !== 16 || flags.length !== 2) {
      return null;
    }

    return { traceId, spanId, flags };
  }

  /**
   * Generate secure random hex string
   */
  private generateHex(length: number): string {
    return randomBytes(length / 2).toString('hex');
  }

  /**
   * Generate UUID v4
   */
  private generateUUID(): string {
    const bytes = randomBytes(16);
    bytes[6] = (bytes[6] & 0x0f) | 0x40; // Version 4
    bytes[8] = (bytes[8] & 0x3f) | 0x80; // Variant 10
    
    const hex = bytes.toString('hex');
    return [
      hex.slice(0, 8),
      hex.slice(8, 12),
      hex.slice(12, 16),
      hex.slice(16, 20),
      hex.slice(20, 32)
    ].join('-');
  }

  /**
   * Generate short request ID
   */
  private generateRequestId(): string {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    let result = '';
    const bytes = randomBytes(8);
    
    for (let i = 0; i < 8; i++) {
      result += chars[bytes[i] % chars.length];
    }
    
    return result;
  }

  /**
   * Add tracing headers to response
   */
  private addResponseHeaders(res: Response, context: CorrelationContext): void {
    const traceparent = `00-${context.trace.traceId}-${context.trace.spanId}-${context.trace.flags}`;
    
    res.setHeader('traceparent', traceparent);
    res.setHeader('x-correlation-id', context.correlationId);
    res.setHeader('x-request-id', context.requestId);
    
    if (context.trace.parentSpanId) {
      res.setHeader('x-parent-span-id', context.trace.parentSpanId);
    }
  }

  /**
   * Log incoming request with correlation context
   */
  private logRequest(req: RequestWithCorrelation, context: CorrelationContext): void {
    // Skip health check endpoints
    if (req.path.includes('/health')) {
      return;
    }

    const logData = {
      correlationId: context.correlationId,
      requestId: context.requestId,
      traceId: context.trace.traceId,
      spanId: context.trace.spanId,
      parentSpanId: context.trace.parentSpanId,
      method: req.method,
      path: req.path,
      userAgent: req.headers['user-agent']?.substring(0, 100), // Truncate for security
      ip: this.getClientIp(req),
      sessionId: context.sessionId,
      userId: context.userId && this.hashUserId(context.userId)
    };

    this.logger.log(`${req.method} ${req.path}`, logData);
  }

  /**
   * Log response with performance metrics
   */
  private logResponse(req: RequestWithCorrelation, res: Response, context: CorrelationContext): void {
    // Skip health check endpoints
    if (req.path.includes('/health')) {
      return;
    }

    const duration = Date.now() - context.startTime;
    const isError = res.statusCode >= 400;

    const logData = {
      correlationId: context.correlationId,
      requestId: context.requestId,
      traceId: context.trace.traceId,
      spanId: context.trace.spanId,
      method: req.method,
      path: req.path,
      statusCode: res.statusCode,
      duration: `${duration}ms`,
      contentLength: res.getHeader('content-length') || 0
    };

    if (isError) {
      this.logger.error(`${req.method} ${req.path} - ${res.statusCode}`, logData);
    } else {
      this.logger.log(`${req.method} ${req.path} - ${res.statusCode}`, logData);
    }
  }

  /**
   * Get client IP address safely
   */
  private getClientIp(req: Request): string {
    const forwarded = req.headers['x-forwarded-for'] as string;
    if (forwarded) {
      return forwarded.split(',')[0].trim();
    }
    return req.connection.remoteAddress || 'unknown';
  }

  /**
   * Hash user ID for production security
   */
  private hashUserId(userId: string): string {
    if (process.env.NODE_ENV !== 'production') {
      return userId;
    }
    
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
 * Decorator to get correlation context in controllers
 */
export const CorrelationContext = () => {
  return (target: any, propertyKey: string, parameterIndex: number) => {
    // This would be implemented as a custom parameter decorator
    // For now, access via req.correlationContext in controllers
  };
};

/**
 * Utility to get current correlation context from request
 */
export function getCorrelationContext(req: any): CorrelationContext | null {
  return req.correlationContext || null;
}