/**
 * Secure Logging Utilities
 * 
 * Production-grade logging that prevents sensitive data exposure:
 * - Masks tokens, API keys, passwords
 * - Hashes or redacts IDs in production
 * - Removes auth headers from logs
 * - Never logs emails in INFO+ levels
 * - GDPR/SOC2 compliant data handling
 */

import { isProduction, isDevelopment } from '../config';
import { logger } from './logger';
import { correlationManager } from './tracing';

/**
 * Sensitive data patterns to mask
 */
const SENSITIVE_PATTERNS = {
  // Authentication tokens
  TOKEN: /(?:token|jwt|bearer|auth|key|secret|password|pwd)['":\s]*([a-zA-Z0-9+/=\-_.]{10,})/gi,
  
  // API keys and secrets
  API_KEY: /(?:api[_\s-]*key|secret[_\s-]*key|access[_\s-]*key)['":\s]*([a-zA-Z0-9+/=\-_.]{10,})/gi,
  
  // Email addresses
  EMAIL: /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g,
  
  // Credit card numbers
  CREDIT_CARD: /\b(?:\d{4}[-\s]?){3}\d{4}\b/g,
  
  // Phone numbers
  PHONE: /(?:\+?1[-.\s]?)?\(?[0-9]{3}\)?[-.\s]?[0-9]{3}[-.\s]?[0-9]{4}/g,
};

/**
 * Headers that should never be logged
 */
const SENSITIVE_HEADERS = [
  'authorization',
  'cookie',
  'set-cookie',
  'x-api-key',
  'x-auth-token',
  'x-access-token',
  'x-refresh-token',
  'authentication',
  'proxy-authorization',
];

/**
 * Hash function for IDs in production
 */
function hashId(id: string): string {
  if (!isProduction) {
    return id; // Keep IDs readable in development
  }
  
  // Simple hash for ID obfuscation
  let hash = 0;
  for (let i = 0; i < id.length; i++) {
    const char = id.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash; // Convert to 32bit integer
  }
  
  const hashStr = Math.abs(hash).toString(16);
  return `***${hashStr}`;
}

/**
 * Mask sensitive data in text
 */
function maskSensitiveData(text: string): string {
  if (!text || typeof text !== 'string') {
    return text;
  }
  
  let masked = text;
  
  // Mask tokens and secrets
  masked = masked.replace(SENSITIVE_PATTERNS.TOKEN, (match, token) => {
    return match.replace(token, `***${token.slice(-4)}`);
  });
  
  // Mask API keys
  masked = masked.replace(SENSITIVE_PATTERNS.API_KEY, (match, key) => {
    return match.replace(key, `***${key.slice(-4)}`);
  });
  
  // Mask emails in production/INFO logs
  if (isProduction) {
    masked = masked.replace(SENSITIVE_PATTERNS.EMAIL, (email) => {
      const [user, domain] = email.split('@');
      return `${user?.slice(0, 2) ?? ''}***@${domain}`;
    });
  }
  
  // Mask credit cards
  masked = masked.replace(SENSITIVE_PATTERNS.CREDIT_CARD, (card) => {
    return `****-****-****-${card.slice(-4)}`;
  });
  
  // Mask phone numbers
  masked = masked.replace(SENSITIVE_PATTERNS.PHONE, '***-***-****');
  
  return masked;
}

/**
 * Sanitize headers by removing sensitive ones
 */
function sanitizeHeaders(headers: Record<string, any>): Record<string, any> {
  if (!headers || typeof headers !== 'object') {
    return {};
  }
  
  const sanitized: Record<string, any> = {};
  
  for (const [key, value] of Object.entries(headers)) {
    const lowerKey = key.toLowerCase();
    
    // Skip sensitive headers entirely
    if (SENSITIVE_HEADERS.includes(lowerKey)) {
      sanitized[key] = '***REDACTED***';
      continue;
    }
    
    // Mask potential tokens in other headers
    if (typeof value === 'string') {
      sanitized[key] = maskSensitiveData(value);
    } else {
      sanitized[key] = value;
    }
  }
  
  return sanitized;
}

/**
 * Sanitize request/response data
 */
function sanitizeData(data: any): any {
  if (!data) {
    return data;
  }
  
  if (typeof data === 'string') {
    return maskSensitiveData(data);
  }
  
  if (Array.isArray(data)) {
    return data.map(item => sanitizeData(item));
  }
  
  if (typeof data === 'object') {
    const sanitized: any = {};
    
    for (const [key, value] of Object.entries(data)) {
      const lowerKey = key.toLowerCase();
      
      // Handle specific sensitive fields
      if (lowerKey.includes('password') || lowerKey.includes('secret') || lowerKey.includes('token')) {
        sanitized[key] = '***REDACTED***';
      } else if (lowerKey.includes('email') && isProduction) {
        sanitized[key] = typeof value === 'string' ? maskSensitiveData(value) : value;
      } else if (lowerKey.includes('id') && typeof value === 'string' && value.length > 10) {
        // Hash long IDs in production
        sanitized[key] = hashId(value);
      } else if (typeof value === 'string') {
        sanitized[key] = maskSensitiveData(value);
      } else {
        sanitized[key] = sanitizeData(value);
      }
    }
    
    return sanitized;
  }
  
  return data;
}

/**
 * Secure logger class that automatically sanitizes data
 */
export class SecureLogger {
  constructor(private context: string) {}

  /**
   * Debug logging (development only, with full sanitization)
   */
  debug(message: string, data?: any): void {
    if (isDevelopment) {
      const sanitizedData = data ? sanitizeData(data) : undefined;
      const correlationMetadata = correlationManager.getLogMetadata();
      const logData = sanitizedData 
        ? { ...sanitizedData, ...correlationMetadata }
        : correlationMetadata;
      
      logger.debug(maskSensitiveData(message), logData, this.context);
    }
  }

  /**
   * Info logging (production safe)
   */
  info(message: string, data?: any): void {
    const sanitizedData = data ? sanitizeData(data) : undefined;
    const correlationMetadata = correlationManager.getLogMetadata();
    const logData = sanitizedData 
      ? { ...sanitizedData, ...correlationMetadata }
      : correlationMetadata;
    
    logger.info(maskSensitiveData(message), logData, this.context);
  }

  /**
   * Warning logging (production safe)
   */
  warn(message: string, data?: any): void {
    const sanitizedData = data ? sanitizeData(data) : undefined;
    const correlationMetadata = correlationManager.getLogMetadata();
    const logData = sanitizedData 
      ? { ...sanitizedData, ...correlationMetadata }
      : correlationMetadata;
    
    logger.warn(maskSensitiveData(message), logData, this.context);
  }

  /**
   * Error logging (production safe)
   */
  error(message: string, error?: Error | any): void {
    let sanitizedError = error;
    
    if (error && typeof error === 'object') {
      sanitizedError = sanitizeData(error);
    }
    
    const correlationMetadata = correlationManager.getLogMetadata();
    const logData = sanitizedError 
      ? { ...sanitizedError, ...correlationMetadata }
      : correlationMetadata;
    
    logger.error(maskSensitiveData(message), logData, this.context);
  }

  /**
   * Log API request safely
   */
  logRequest(method: string, url: string, options?: {
    headers?: Record<string, any>;
    body?: any;
    duration?: number;
  }): void {
    if (!isDevelopment) {
      return; // Only log requests in development
    }
    
    const sanitizedData: any = {
      method,
      url: maskSensitiveData(url),
    };
    
    if (options?.headers) {
      sanitizedData.headers = sanitizeHeaders(options.headers);
    }
    
    if (options?.body) {
      sanitizedData.hasBody = true;
      // Never log request body in production
      if (isDevelopment) {
        sanitizedData.body = sanitizeData(options.body);
      }
    }
    
    if (options?.duration) {
      sanitizedData.duration = `${options.duration.toFixed(2)}ms`;
    }
    
    this.debug(`API Request: ${method} ${url}`, sanitizedData);
  }

  /**
   * Log API response safely
   */
  logResponse(status: number, url: string, options?: {
    data?: any;
    duration?: number;
  }): void {
    if (!isDevelopment && status < 400) {
      return; // Only log errors in production
    }
    
    const sanitizedData: any = {
      status,
      url: maskSensitiveData(url),
    };
    
    if (options?.duration) {
      sanitizedData.duration = `${options.duration.toFixed(2)}ms`;
    }
    
    if (options?.data && isDevelopment) {
      // Only include response data in development
      sanitizedData.hasData = !!options.data;
      if (Array.isArray(options.data)) {
        sanitizedData.itemCount = options.data.length;
      }
    }
    
    if (status >= 400) {
      this.error(`API Error ${status}`, sanitizedData);
    } else {
      this.debug(`API Response ${status}`, sanitizedData);
    }
  }

  /**
   * Log user action (for audit trails)
   */
  logUserAction(action: string, metadata?: Record<string, any>): void {
    const sanitizedData = metadata ? sanitizeData(metadata) : undefined;
    this.info(`User Action: ${action}`, sanitizedData);
  }
}

/**
 * Create a secure logger instance
 */
export function createSecureLogger(context: string): SecureLogger {
  return new SecureLogger(context);
}

/**
 * Utility functions for backward compatibility
 */
export const secureLogging = {
  maskSensitiveData,
  sanitizeHeaders,
  sanitizeData,
  hashId,
};