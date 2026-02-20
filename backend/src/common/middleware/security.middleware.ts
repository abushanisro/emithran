import { Injectable, NestMiddleware } from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';

/**
 * Security middleware for production-grade applications
 * Implements comprehensive security headers and protections
 */

@Injectable()
export class SecurityMiddleware implements NestMiddleware {
  use(req: Request, res: Response, next: NextFunction) {
    // Content Security Policy (CSP)
    res.setHeader(
      'Content-Security-Policy',
      [
        "default-src 'self'",
        "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://cdn.jsdelivr.net https://unpkg.com",
        "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
        "font-src 'self' https://fonts.gstatic.com",
        "img-src 'self' data: https:",
        "connect-src 'self' https: wss: ws:",
        "frame-src 'self' https://*.supabase.co",
        "object-src 'none'",
        "base-uri 'self'",
        "form-action 'self'",
        "frame-ancestors 'none'",
        "upgrade-insecure-requests"
      ].join('; ')
    );

    // X-Frame-Options (clickjacking protection)
    res.setHeader('X-Frame-Options', 'DENY');

    // X-Content-Type-Options (MIME type sniffing protection)
    res.setHeader('X-Content-Type-Options', 'nosniff');

    // X-XSS-Protection (XSS protection)
    res.setHeader('X-XSS-Protection', '1; mode=block');

    // Referrer Policy (control referrer information)
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');

    // Permissions Policy (formerly Feature Policy)
    res.setHeader(
      'Permissions-Policy',
      [
        'camera=()',
        'microphone=()',
        'geolocation=()',
        'payment=()',
        'usb=()',
        'magnetometer=()',
        'gyroscope=()',
        'accelerometer=()',
        'ambient-light-sensor=()',
        'autoplay=self'
      ].join(', ')
    );

    // Strict Transport Security (HSTS) - only in production with HTTPS
    if (process.env.NODE_ENV === 'production' && req.secure) {
      res.setHeader(
        'Strict-Transport-Security',
        'max-age=31536000; includeSubDomains; preload'
      );
    }

    // Remove server identification
    res.removeHeader('X-Powered-By');
    res.setHeader('Server', 'Mithran-API');

    // Cache control for API responses
    if (req.path.includes('/api/')) {
      // Don't cache API responses by default
      res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
      res.setHeader('Pragma', 'no-cache');
      res.setHeader('Expires', '0');
    }

    // Rate limit headers (if not already set by rate limiter)
    if (!res.hasHeader('X-RateLimit-Limit')) {
      res.setHeader('X-RateLimit-Limit', '100');
      res.setHeader('X-RateLimit-Remaining', '100');
      res.setHeader('X-RateLimit-Reset', Date.now() + 15 * 60 * 1000);
    }

    // CORS headers (if not already handled by CORS middleware)
    const origin = req.get('Origin');
    const allowedOrigins = process.env.ALLOWED_ORIGINS?.split(',') || [
      process.env.CORS_ORIGIN || 'https://mithran-six.vercel.app',
      'http://localhost:3000',
      'https://localhost:3000'
    ];

    if (origin && allowedOrigins.includes(origin)) {
      res.setHeader('Access-Control-Allow-Origin', origin);
    }

    res.setHeader('Access-Control-Allow-Credentials', 'true');
    res.setHeader(
      'Access-Control-Allow-Methods',
      'GET, POST, PUT, PATCH, DELETE, OPTIONS'
    );
    res.setHeader(
      'Access-Control-Allow-Headers',
      [
        'Content-Type',
        'Authorization',
        'X-Requested-With',
        'Accept',
        'Origin',
        'Cache-Control',
        'X-File-Name',
        'X-API-Key'
      ].join(', ')
    );
    res.setHeader('Access-Control-Max-Age', '86400'); // 24 hours

    // Handle preflight requests
    if (req.method === 'OPTIONS') {
      res.status(204).end();
      return;
    }

    next();
  }
}

/**
 * Request sanitization middleware
 * Sanitizes incoming request data to prevent attacks
 */
@Injectable()
export class RequestSanitizationMiddleware implements NestMiddleware {
  private readonly dangerousPatterns = [
    // XSS patterns
    /<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi,
    /javascript:/gi,
    /on\w+\s*=/gi,
    
    // SQL injection patterns
    /(\b(SELECT|INSERT|UPDATE|DELETE|DROP|CREATE|ALTER|EXEC|EXECUTE)\b)/gi,
    /(UNION\s+(ALL\s+)?SELECT)/gi,
    /(\bOR\b\s*\d+\s*=\s*\d+)/gi,
    
    // Path traversal patterns
    /\.\.[\/\\]/gi,
    /\.(exe|bat|cmd|com|pif|scr|vbs|js)$/gi,
  ];

  use(req: Request, res: Response, next: NextFunction) {
    try {
      // Sanitize query parameters
      if (req.query) {
        req.query = this.sanitizeObject(req.query);
      }

      // Sanitize request body
      if (req.body) {
        req.body = this.sanitizeObject(req.body);
      }

      // Sanitize headers
      const suspiciousHeaders = ['user-agent', 'referer', 'x-forwarded-for'];
      suspiciousHeaders.forEach(header => {
        if (req.headers[header] && typeof req.headers[header] === 'string') {
          req.headers[header] = this.sanitizeString(req.headers[header] as string);
        }
      });

      next();
    } catch (error) {
      res.status(400).json({ 
        message: 'Invalid request format',
        statusCode: 400 
      });
    }
  }

  private sanitizeObject(obj: any): any {
    if (obj === null || obj === undefined) return obj;
    
    if (typeof obj === 'string') {
      return this.sanitizeString(obj);
    }
    
    if (Array.isArray(obj)) {
      return obj.map(item => this.sanitizeObject(item));
    }
    
    if (typeof obj === 'object') {
      const sanitized: any = {};
      for (const [key, value] of Object.entries(obj)) {
        sanitized[this.sanitizeString(key)] = this.sanitizeObject(value);
      }
      return sanitized;
    }
    
    return obj;
  }

  private sanitizeString(str: string): string {
    if (typeof str !== 'string') return str;
    
    let sanitized = str;
    
    // Remove dangerous patterns
    this.dangerousPatterns.forEach(pattern => {
      sanitized = sanitized.replace(pattern, '');
    });
    
    // Encode HTML entities
    sanitized = sanitized
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#x27;')
      .replace(/\//g, '&#x2F;');
    
    // Limit length to prevent DoS
    if (sanitized.length > 10000) {
      sanitized = sanitized.substring(0, 10000);
    }
    
    return sanitized;
  }
}

/**
 * API versioning middleware
 * Handles API version headers and routing
 */
@Injectable()
export class ApiVersioningMiddleware implements NestMiddleware {
  use(req: Request, res: Response, next: NextFunction) {
    // Get version from header or URL
    const versionHeader = req.get('Accept-Version') || req.get('X-API-Version');
    const urlVersion = req.path.match(/^\/api\/v(\d+)\//)?.[1];
    
    const version = versionHeader || urlVersion || '1';
    
    // Add version to request for use in controllers
    (req as any).apiVersion = version;
    
    // Add version to response headers
    res.setHeader('X-API-Version', version);
    
    // Handle deprecated versions
    if (parseInt(version) < 1) {
      res.setHeader('Warning', '299 - "API version deprecated"');
    }
    
    next();
  }
}