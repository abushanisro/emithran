/**
 * Centralized API Configuration Management
 * Enterprise-grade configuration with environment separation
 */

export interface ApiEndpoints {
  base: string;
  gateway: string;
  health: string;
  api: {
    v1: string;
  };
  cad: string;
}

export interface ApiConfig {
  endpoints: ApiEndpoints;
  timeouts: {
    default: number;
    upload: number;
    health: number;
  };
  retry: {
    attempts: number;
    delay: number;
    backoff: number;
  };
  environment: 'development' | 'production';
}

/**
 * Get environment-specific API configuration
 */
function createApiConfig(): ApiConfig {
  const baseUrl = process.env.NEXT_PUBLIC_API_GATEWAY_URL || 'http://localhost:4000';
  const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000/v1/api';
  const cadUrl = process.env.NEXT_PUBLIC_CAD_ENGINE_URL || 'http://localhost:5000';
  
  return {
    endpoints: {
      base: baseUrl,
      gateway: baseUrl,
      health: `${baseUrl}/api/health`,
      api: {
        v1: apiUrl,
      },
      cad: cadUrl,
    },
    timeouts: {
      default: 10000, // 10 seconds
      upload: 60000,  // 60 seconds for file uploads
      health: 5000,   // 5 seconds for health checks
    },
    retry: {
      attempts: 3,
      delay: 1000,    // 1 second initial delay
      backoff: 2,     // Exponential backoff multiplier
    },
    environment: (process.env.NODE_ENV as 'development' | 'production') || 'development',
  };
}

export const apiConfig = createApiConfig();

/**
 * Validate API configuration
 */
export function validateApiConfig(): boolean {
  const required = [
    'NEXT_PUBLIC_API_URL',
    'NEXT_PUBLIC_API_GATEWAY_URL',
  ];

  const missing = required.filter(key => !process.env[key]);
  
  if (missing.length > 0) {
    console.error('Missing required environment variables:', missing);
    return false;
  }

  try {
    new URL(apiConfig.endpoints.base);
    new URL(apiConfig.endpoints.api.v1);
    return true;
  } catch (error) {
    console.error('Invalid API URLs in configuration:', error);
    return false;
  }
}

/**
 * Get service status for monitoring
 */
export function getServiceInfo() {
  return {
    environment: apiConfig.environment,
    endpoints: apiConfig.endpoints,
    isValid: validateApiConfig(),
    timestamp: new Date().toISOString(),
  };
}