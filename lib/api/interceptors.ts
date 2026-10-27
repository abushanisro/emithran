/**
 * API Interceptors
 *
 * Request and response interceptors for logging, monitoring, and analytics
 */


import { createSecureLogger } from '../utils/secure-logger';
import { correlationManager, generateCorrelationContext } from '../utils/tracing';

export interface RequestConfig {
  url: string;
  method: string;
  headers: Record<string, string>;
  body?: any;
}

const secureLogger = createSecureLogger('API');

/**
 * Request logger interceptor
 * Uses secure logging that masks sensitive data
 */
export const requestLoggerInterceptor = (config: RequestConfig): RequestConfig => {
  // Skip logging for health checks and frequent polling endpoints
  const isHealthCheck = config.url.includes('/health');
  const isFrequentPolling = config.url.includes('/status') || config.url.includes('/tracking');
  
  if (!isHealthCheck && !isFrequentPolling) {
    secureLogger.logRequest(config.method, config.url, {
      headers: config.headers,
      body: config.body
    });
  }
  return config;
};

/**
 * Response logger interceptor
 * Uses secure logging that masks sensitive data
 */
export const responseLoggerInterceptor = (response: any): any => {
  const isHealthCheck = response?.config?.url?.includes('/health');
  
  if (!isHealthCheck) {
    secureLogger.logResponse(
      response?.status || 0,
      response?.config?.url || '',
      {
        data: response?.data
      }
    );
  }
  return response;
};

/**
 * Add correlation ID and distributed tracing headers
 */
export const correlationIdInterceptor = (config: RequestConfig): RequestConfig => {
  // Get or generate correlation context
  let context = correlationManager.get();
  if (!context) {
    context = generateCorrelationContext();
  }

  // Only the session-level grouping ids. traceparent and x-request-id belong to the request itself (the API client
  // sets one trace and one request id per request); this session-wide context used to overwrite them, putting every
  // request of a tab in one trace under one request id. x-user-id is never sent: nothing on the backend reads it.
  const { 'x-correlation-id': correlationId, 'x-session-id': sessionId } = correlationManager.getHeaders();
  if (correlationId) config.headers['x-correlation-id'] = correlationId;
  if (sessionId) config.headers['x-session-id'] = sessionId;

  return config;
};

/**
 * Add custom headers
 */
export const customHeadersInterceptor = (config: RequestConfig): RequestConfig => {
  config.headers['X-Client-Version'] = process.env.NEXT_PUBLIC_APP_VERSION || '1.0.0';
  config.headers['X-Client-Platform'] = 'web';

  return config;
};

/**
 * Setup all interceptors on the API client
 */
export const setupInterceptors = (apiClient: any) => {
  apiClient.addRequestInterceptor(requestLoggerInterceptor);
  apiClient.addRequestInterceptor(correlationIdInterceptor);
  apiClient.addRequestInterceptor(customHeadersInterceptor);
  apiClient.addResponseInterceptor(responseLoggerInterceptor);
};
