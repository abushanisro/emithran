
/**
 * React Hook for Correlation Context Management
 * 
 * Provides session-wide correlation context for request tracing:
 * - Initializes correlation context on component mount
 * - Persists trace context across page navigation
 * - Generates session-scoped correlation IDs
 * - Integrates with user authentication state
 */

import { useEffect, useRef } from 'react';
import { correlationManager, generateCorrelationContext } from '../utils/tracing';

/**
 * Hook to initialize and manage correlation context
 * Can optionally accept user ID to update context with auth state
 */
export function useCorrelationContext(userId?: string) {
  const initialized = useRef(false);
  const sessionId = useRef<string | undefined>(undefined);

  useEffect(() => {
    // Only initialize once per session
    if (!initialized.current) {
      // Generate session ID if not exists
      if (!sessionId.current) {
        sessionId.current = generateSessionId();
      }

      // Initialize correlation context with user information
      const context = generateCorrelationContext({
        sessionId: sessionId.current,
        ...(userId !== undefined ? { userId } : {})
      });

      initialized.current = true;

      // Store in sessionStorage for persistence across page navigation
      try {
        sessionStorage.setItem('correlationContext', JSON.stringify({
          sessionId: sessionId.current,
          traceId: context.trace.traceId,
          correlationId: context.correlationId
        }));
      } catch (error) {
        // Ignore storage errors
        
      }
    }
  }, [userId]);

  // Update user ID in context when auth state changes
  useEffect(() => {
    if (initialized.current && userId) {
      const current = correlationManager.get();
      if (current && current.userId !== userId) {
        // Create new context with updated user ID
        generateCorrelationContext({
          ...(sessionId.current !== undefined ? { sessionId: sessionId.current } : {}),
          userId
        });
      }
    }
  }, [userId]);

  return {
    isInitialized: initialized.current,
    sessionId: sessionId.current,
    getContext: () => correlationManager.get(),
    getHeaders: () => correlationManager.getHeaders()
  };
}

/**
 * Generate session ID for browser session tracking
 */
function generateSessionId(): string {
  // Try to restore from sessionStorage first
  try {
    const stored = sessionStorage.getItem('correlationContext');
    if (stored) {
      const parsed = JSON.parse(stored);
      if (parsed.sessionId) {
        return parsed.sessionId;
      }
    }
  } catch (error) {
    // Ignore parsing errors
  }

  // Generate new session ID
  const timestamp = Date.now().toString(36);
  const random = Math.random().toString(36).substring(2, 8);
  return `ses_${timestamp}_${random}`;
}

/**
 * Hook for components that need to track specific operations
 */
export function useOperationTracing() {
  const { getContext } = useCorrelationContext();

  const trackOperation = async <T>(
    operationName: string,
    operation: () => Promise<T>,
    metadata?: Record<string, any>
  ): Promise<T> => {
    const context = getContext();
    const startTime = performance.now();

    try {
      const result = await operation();
      const duration = performance.now() - startTime;

      // Log successful operation with correlation context
      console.log(`[TRACE] ${operationName}`, {
        ...context && correlationManager.getLogMetadata(),
        duration: `${duration.toFixed(2)}ms`,
        success: true,
        ...metadata
      });

      return result;
    } catch (error) {
      const duration = performance.now() - startTime;

      // Log failed operation with correlation context
      console.error(`[TRACE] ${operationName} FAILED`, {
        ...context && correlationManager.getLogMetadata(),
        duration: `${duration.toFixed(2)}ms`,
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
        ...metadata
      });

      throw error;
    }
  };

  return { trackOperation };
}