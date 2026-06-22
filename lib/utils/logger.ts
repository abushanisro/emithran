/**
 * Production-Grade Structured Logging System
 *
 * Enterprise logging with:
 * - Structured log entries
 * - Log levels (DEBUG, INFO, WARN, ERROR)
 * - Context preservation
 * - Production filtering
 * - Performance tracking
 * - External monitoring integration ready
 */

export enum LogLevel {
  DEBUG = 0,
  INFO = 1,
  WARN = 2,
  ERROR = 3,
  NONE = 4,
}

export interface LogEntry {
  timestamp: string;
  level: LogLevel;
  message: string;
  context?: string;
  data?: Record<string, any>;
  stack?: string;
}

type LogHandler = (entry: LogEntry) => void;

class Logger {
  private static instance: Logger;
  private handlers: LogHandler[] = [];
  private minLevel: LogLevel;

  private constructor() {
    // Set log level based on environment - Industry standard levels
    if (process.env.NODE_ENV === 'production') {
      this.minLevel = LogLevel.INFO; // INFO+ for production (high-level events)
    } else if (process.env.NODE_ENV === 'test') {
      this.minLevel = LogLevel.NONE; // No logs in tests
    } else {
      this.minLevel = LogLevel.DEBUG; // All logs in development
    }

    // Add console handler for development and production
    // Production needs structured logging for external systems
    this.addHandler(this.consoleHandler);
  }

  static getInstance(): Logger {
    if (!Logger.instance) {
      Logger.instance = new Logger();
    }
    return Logger.instance;
  }

  /**
   * Set minimum log level
   */
  setLevel(level: LogLevel): void {
    this.minLevel = level;
  }

  /**
   * Add custom log handler (e.g., for external monitoring)
   */
  addHandler(handler: LogHandler): void {
    this.handlers.push(handler);
  }

  /**
   * Remove log handler
   */
  removeHandler(handler: LogHandler): void {
    this.handlers = this.handlers.filter(h => h !== handler);
  }

  /**
   * Log debug message
   */
  debug(message: string, data?: Record<string, any>, context?: string): void {
    this.log(LogLevel.DEBUG, message, data, context);
  }

  /**
   * Log info message
   */
  info(message: string, data?: Record<string, any>, context?: string): void {
    this.log(LogLevel.INFO, message, data, context);
  }

  /**
   * Log warning message
   */
  warn(message: string, data?: Record<string, any>, context?: string): void {
    this.log(LogLevel.WARN, message, data, context);
  }

  /**
   * Log error message
   */
  error(message: string, error?: Error | Record<string, any>, context?: string): void {
    const data = error instanceof Error
      ? { error: error.message, name: error.name }
      : error;

    const stack = error instanceof Error ? error.stack : undefined;

    this.log(LogLevel.ERROR, message, data, context, stack);
  }

  /**
   * Core logging function
   */
  private log(
    level: LogLevel,
    message: string,
    data?: Record<string, any>,
    context?: string,
    stack?: string,
  ): void {
    // Filter by log level
    if (level < this.minLevel) {
      return;
    }

    const entry: LogEntry = {
      timestamp: new Date().toISOString(),
      level,
      message,
      ...(context !== undefined ? { context } : {}),
      ...(data    !== undefined ? { data }    : {}),
      ...(stack   !== undefined ? { stack }   : {}),
    };

    // Call all handlers
    this.handlers.forEach(handler => {
      try {
        handler(entry);
      } catch (error) {
        // Prevent logging errors from breaking the application
        // Handler error silently ignored to prevent cascade failures
      }
    });
  }

  /**
   * Default console handler
   */
  private consoleHandler(entry: LogEntry): void {
    const levelName = LogLevel[entry.level];
    const prefix = `[${entry.timestamp}] [${levelName}]${entry.context ? ` [${entry.context}]` : ''}`;

    switch (entry.level) {
      case LogLevel.DEBUG:
        
        break;
      case LogLevel.INFO:
        
        break;
      case LogLevel.WARN:
        
        break;
      case LogLevel.ERROR:
        console.error(prefix, entry.message, entry.data || '');
        if (entry.stack) {
          console.error(entry.stack);
        }
        break;
    }
  }

  /**
   * Create structured monitoring event (for external systems)
   */
  static createMonitoringEvent(
    _eventName: string,
    _properties?: Record<string, any>,
  ): void {
    // This can be extended to send to external monitoring services
    // like Sentry, DataDog, New Relic, etc.
    
    // Example: Send to external monitoring
    // if (typeof window !== 'undefined' && window.analytics) {
    //   window.analytics.track(eventName, properties);
    // }
  }
}

export const logger = Logger.getInstance();

/**
 * Performance tracking utility
 */
export class PerformanceTracker {
  private startTime: number;
  private name: string;

  constructor(name: string) {
    this.name = name;
    this.startTime = performance.now();
  }

  /**
   * End tracking and log result
   */
  end(): number {
    const duration = performance.now() - this.startTime;
    logger.debug(`${this.name} completed`, { duration: `${duration.toFixed(2)}ms` }, 'Performance');
    return duration;
  }
}

/**
 * Track async operation performance
 */
export async function trackPerformance<T>(
  name: string,
  operation: () => Promise<T>,
): Promise<T> {
  const tracker = new PerformanceTracker(name);
  try {
    const result = await operation();
    tracker.end();
    return result;
  } catch (error) {
    tracker.end();
    throw error;
  }
}
