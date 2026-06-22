/**
 * Component-Level Logging Utilities
 * 
 * Production-ready logging for React components and API services
 * - Structured logging with context
 * - Environment-aware log levels
 * - Performance tracking
 * - Error boundary integration
 */

import { createSecureLogger } from './secure-logger';
import { isDevelopment } from '../config';

/**
 * Component logger with contextual information
 * Uses secure logging that automatically masks sensitive data
 */
export class ComponentLogger {
  private secureLogger: ReturnType<typeof createSecureLogger>;

  constructor(context: string) {
    this.secureLogger = createSecureLogger(context);
  }

  /**
   * Log debug information (development only, secure)
   */
  debug(message: string, data?: Record<string, any>): void {
    this.secureLogger.debug(message, data);
  }

  /**
   * Log informational events (production visible, secure)
   */
  info(message: string, data?: Record<string, any>): void {
    this.secureLogger.info(message, data);
  }

  /**
   * Log warnings (always visible, secure)
   */
  warn(message: string, data?: Record<string, any>): void {
    this.secureLogger.warn(message, data);
  }

  /**
   * Log errors (always visible, secure)
   */
  error(message: string, error?: Error | Record<string, any>): void {
    this.secureLogger.error(message, error);
  }

  /**
   * Track async operation performance
   */
  async trackOperation<T>(
    operationName: string,
    operation: () => Promise<T>,
    metadata?: Record<string, any>
  ): Promise<T> {
    const startTime = performance.now();
    
    if (isDevelopment) {
      this.debug(`Starting ${operationName}`, metadata);
    }

    try {
      const result = await operation();
      const duration = performance.now() - startTime;
      
      this.info(`${operationName} completed`, {
        duration: `${duration.toFixed(2)}ms`,
        success: true,
        ...metadata
      });
      
      return result;
    } catch (error) {
      const duration = performance.now() - startTime;
      
      this.error(`${operationName} failed`, {
        duration: `${duration.toFixed(2)}ms`,
        error: error instanceof Error ? error.message : 'Unknown error',
        ...metadata
      });
      
      throw error;
    }
  }

  /**
   * Log data loading operations with smart filtering
   */
  logDataLoad(operation: string, data: any, options?: {
    skipEmpty?: boolean;
    includeSize?: boolean;
  }): void {
    const { skipEmpty = true, includeSize = true } = options || {};
    
    // Skip logging empty data loads unless explicitly requested
    if (skipEmpty && (!data || (Array.isArray(data) && data.length === 0))) {
      return;
    }

    const logData: Record<string, any> = {
      operation,
      hasData: !!data
    };

    if (includeSize && Array.isArray(data)) {
      logData.itemCount = data.length;
    } else if (includeSize && data && typeof data === 'object') {
      logData.dataSize = Object.keys(data).length;
    }

    this.debug(`Data loaded: ${operation}`, logData);
  }

  /**
   * Log component lifecycle events
   */
  logLifecycle(event: 'mount' | 'unmount' | 'update', data?: Record<string, any>): void {
    if (isDevelopment) {
      this.debug(`Component ${event}`, data);
    }
  }
}

/**
 * Create a component logger instance
 */
export function createComponentLogger(componentName: string): ComponentLogger {
  return new ComponentLogger(componentName);
}

/**
 * API operation logger - specialized for API calls
 */
export class ApiLogger extends ComponentLogger {
  constructor(service: string) {
    super(`API:${service}`);
  }

  /**
   * Log API operation start (development only)
   */
  logRequestStart(method: string, endpoint: string, metadata?: Record<string, any>): void {
    if (isDevelopment) {
      this.debug(`${method} ${endpoint}`, metadata);
    }
  }

  /**
   * Log successful API response
   */
  logResponse(
    method: string, 
    endpoint: string, 
    responseData: any,
    duration?: number
  ): void {
    if (isDevelopment) {
      const logData: Record<string, any> = {
        method,
        endpoint,
        hasData: !!responseData
      };

      if (duration) {
        logData.duration = `${duration.toFixed(2)}ms`;
      }

      if (Array.isArray(responseData)) {
        logData.itemCount = responseData.length;
      }

      this.debug('API Response', logData);
    }
  }

  /**
   * Log API requests with context
   */
  logApiRequest(
    method: string,
    endpoint: string,
    metadata?: Record<string, any>
  ): void {
    const requestData = {
      method,
      endpoint,
      timestamp: new Date().toISOString(),
      ...metadata
    };

    this.info(`API Request: ${method} ${endpoint}`, requestData);
  }

  /**
   * Log API responses with context
   */
  logApiResponse(
    method: string,
    endpoint: string,
    response: any,
    metadata?: Record<string, any>
  ): void {
    const responseData = {
      method,
      endpoint,
      status: response?.status,
      timestamp: new Date().toISOString(),
      ...metadata
    };

    this.info(`API Response: ${method} ${endpoint}`, responseData);
  }

  /**
   * Log API errors with context
   */
  logApiError(
    method: string,
    endpoint: string,
    error: any,
    metadata?: Record<string, any>
  ): void {
    const errorData = {
      method,
      endpoint,
      status: error?.response?.status,
      statusText: error?.response?.statusText,
      ...metadata
    };

    this.error('API Error', errorData);
  }
}

/**
 * Create an API logger instance
 */
export function createApiLogger(serviceName: string): ApiLogger {
  return new ApiLogger(serviceName);
}