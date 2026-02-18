/**
 * Application Configuration
 *
 * Enterprise-grade configuration management with:
 * - Environment validation
 * - Type safety
 * - Runtime checks
 * - Production best practices
 */

import { envValidator } from './config/env-validator';

// Validate environment on module load
if (typeof window !== 'undefined') {
  // Client-side validation
  const validation = envValidator.validate();
  if (!validation.isValid && process.env.NODE_ENV === 'production') {
    console.error('Environment validation failed:', validation.errors);
  }
  if (process.env.NODE_ENV === 'development') {
    // Log results asynchronously (don't block module loading)
    envValidator.logResults().catch(err => {
      console.error('Environment validation logging failed:', err);
    });
  }
}

export const config = {
  // API Configuration
  api: {
    // Use server-side URL when running on server (Docker network), client-side URL in browser
    baseUrl: (typeof window === 'undefined'
      ? process.env.API_URL
      : process.env.NEXT_PUBLIC_API_URL) || 'http://localhost:4000/v1/api',

    // Timeout Configuration - 2026 Best Practice: Balance between fast fail and database operations
    timeout: process.env.NODE_ENV === 'development' ? 15000 : 30000,

    // Adaptive timeout settings
    adaptiveTimeouts: {
      enabled: true,
      minTimeout: 5000, // Minimum timeout (5s)
      maxTimeout: 60000, // Maximum timeout (60s)
      useHistoricalData: true, // Use metrics to adjust timeouts
    },

    // Endpoint-specific timeout overrides (in milliseconds)
    endpointTimeouts: {
      '/calculators/bom-cost': 45000, // Complex calculations need more time
      '/calculators/process-cost': 45000,
      '/reports': 60000, // Report generation
      '/export': 60000, // File exports
      '/upload': 120000, // File uploads (2 minutes)
    } as Record<string, number>,

    // Retry Configuration
    retryAttempts: process.env.NODE_ENV === 'development' ? 1 : 3,
    retryDelay: process.env.NODE_ENV === 'development' ? 500 : 1000,
    maxRetryDelay: 10000, // Maximum backoff delay (10s)
    retryTimeoutErrors: false, // Fail fast on timeouts - don't cascade errors

    // Circuit Breaker Configuration
    circuitBreaker: {
      enabled: true,
      failureThreshold: process.env.NODE_ENV === 'development' ? 10 : 5, // More tolerant in dev
      successThreshold: 2, // Close circuit after 2 successes in HALF_OPEN
      timeout: process.env.NODE_ENV === 'development' ? 10000 : 30000, // Faster retry in dev
      rollingWindowSize: process.env.NODE_ENV === 'development' ? 20 : 10, // Larger window in dev
    },

    // Distributed Tracing Configuration
    tracing: {
      enabled: true,
      exportToConsole: process.env.NODE_ENV === 'development',
      exportEndpoint: process.env.NEXT_PUBLIC_TRACING_ENDPOINT, // Optional: Jaeger, Zipkin, etc.
      sampleRate: 1.0, // 100% sampling (adjust for production)
    },

    // Idempotency Configuration
    idempotency: {
      enabled: true,
      defaultTTL: 24 * 60 * 60 * 1000, // 24 hours
      autoGenerate: true, // Auto-generate keys for POST/PUT/PATCH
      persistToStorage: false, // Persist to localStorage (optional)
    },

    // Rate Limiting Configuration
    rateLimit: {
      enabled: true,
      respectRetryAfter: true, // Respect server's Retry-After header
      clientSideThrottling: true, // Use token bucket algorithm

      // Global rate limit (token bucket)
      globalLimit: {
        capacity: 1000,
        refillRate: 100, // 100 requests/second
      },

      // Per-endpoint rate limit (token bucket)
      endpointLimit: {
        capacity: 100,
        refillRate: 10, // 10 requests/second per endpoint
      },
    },
  },

  // CAD Engine Configuration
  cadEngine: {
    baseUrl: process.env.NEXT_PUBLIC_CAD_ENGINE_URL || 'http://localhost:5000',
    maxFileSize: 50 * 1024 * 1024, // 50MB
    supportedFormats: ['.step', '.stp', '.iges', '.igs'],
    rateLimit: {
      requests: 10,
      window: 60 * 1000, // 1 minute
    },
  },

  // Authentication Configuration
  auth: {
    tokenKey: 'accessToken',
    refreshTokenKey: 'refreshToken',
    tokenRefreshThreshold: 5 * 60 * 1000, // 5 minutes before expiry
  },

  // Feature Flags
  features: {
    enableAnalytics: process.env.NEXT_PUBLIC_ENABLE_ANALYTICS === 'true',
    enableDebugMode: process.env.NODE_ENV === 'development',
  },

  // Logging Configuration
  logging: {
    // Production: INFO+ only, Development: DEBUG+, Test: NONE
    level: process.env.NODE_ENV === 'production' ? 'INFO' : 
           process.env.NODE_ENV === 'test' ? 'NONE' : 'DEBUG',
    
    // Disable verbose API logging in production
    enableApiLogging: process.env.NODE_ENV === 'development',
    
    // Skip health check and polling endpoint logs
    skipEndpoints: ['/health', '/status', '/tracking'],
    
    // Enable performance tracking
    trackPerformance: true,
    
    // External logging services (production)
    external: {
      enabled: process.env.NODE_ENV === 'production',
      endpoint: process.env.NEXT_PUBLIC_LOGGING_ENDPOINT,
      apiKey: process.env.NEXT_PUBLIC_LOGGING_API_KEY,
    },
  },

  // React Query Configuration
  reactQuery: {
    defaultStaleTime: 5 * 60 * 1000, // 5 minutes
    defaultCacheTime: 10 * 60 * 1000, // 10 minutes
    retryCount: 3,
    refetchOnWindowFocus: false,
    refetchOnReconnect: true,
  },

  // App Configuration
  app: {
    name: 'mithran',
    version: process.env.NEXT_PUBLIC_APP_VERSION || '1.0.0',
    environment: process.env.NODE_ENV || 'development',
  },
};

export const isProduction = config.app.environment === 'production';
export const isDevelopment = config.app.environment === 'development';
export const isTest = config.app.environment === 'test';
