/**
 * Centralized Auth Enabler for React Query
 * 
 * Industry Standard Pattern:
 * - Remove auth logic from individual data hooks
 * - Centralized auth state management
 * - Clean separation of concerns
 */

import { useAuth } from '@/lib/providers/auth';
import { appReadiness } from '@/lib/core/app-readiness';
import { useState, useEffect } from 'react';

interface UseAuthEnabledOptions {
  enabled?: boolean;
}

/**
 * Centralized hook to determine if queries should be enabled based on auth state
 * 
 * @param options - Additional enablement options
 * @returns boolean indicating if queries should be enabled
 */
export function useAuthEnabled(options?: UseAuthEnabledOptions): boolean {
  const { user, loading } = useAuth();
  const [isAppReady, setIsAppReady] = useState(appReadiness.isReady());
  
  // Listen to app readiness changes
  useEffect(() => {
    const unsubscribe = appReadiness.addListener(() => {
      setIsAppReady(appReadiness.isReady());
    });
    return unsubscribe;
  }, []);
  
  const isAuthReady = !!user && !loading;
  const isExplicitlyEnabled = options?.enabled !== false;
  
  // Only enable queries when app is fully ready (auth + backend + environment)
  return isAuthReady && isAppReady && isExplicitlyEnabled;
}

/**
 * Hook to get auth enablement with additional custom conditions
 * 
 * @param customCondition - Additional condition that must be true
 * @param options - Additional enablement options
 * @returns boolean indicating if queries should be enabled
 */
export function useAuthEnabledWith(
  customCondition: boolean, 
  options?: UseAuthEnabledOptions
): boolean {
  const isAuthEnabled = useAuthEnabled(options);
  return isAuthEnabled && customCondition;
}