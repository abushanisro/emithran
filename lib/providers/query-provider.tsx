'use client'

import { QueryClient, QueryClientProvider, QueryCache, MutationCache } from '@tanstack/react-query'
import { useState, type ReactNode } from 'react'
import { ApiError } from '@/lib/api/client'
import { supabase } from '@/lib/supabase/client'
import { toast } from 'sonner'

let hasShownAuthError = false;

export function QueryProvider({ children }: { children: ReactNode }) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        queryCache: new QueryCache({
          onError: (error) => {
            // Global error handler for queries
            handleQueryError(error);
          },
        }),
        mutationCache: new MutationCache({
          onError: (error) => {
            // Global error handler for mutations
            handleQueryError(error);
          },
        }),
        defaultOptions: {
          queries: {
            // Data stays fresh for 5 minutes - prevents duplicate calls
            staleTime: 60 * 1000 * 5, // 5 minutes
            gcTime: 60 * 1000 * 10, // 10 minutes (was cacheTime)
            refetchOnWindowFocus: false,
            refetchOnMount: false, // Don't refetch if data is fresh
            refetchOnReconnect: 'always',
            structuralSharing: true, // Deduplicate requests
            retry: (failureCount, error) => {
              // Don't retry on auth errors
              if (error instanceof ApiError && error.isUnauthorized()) {
                return false;
              }
              // Retry up to 1 time for faster error feedback
              return failureCount < 1;
            },
            retryDelay: (attemptIndex) => Math.min(1000 * 2 ** attemptIndex, 30000),
          },
        },
      })
  )

  return (
    <QueryClientProvider client={queryClient}>
      {children}
    </QueryClientProvider>
  )
}

/**
 * Handle errors from React Query
 */
function handleQueryError(error: unknown): void {
  // Check if it's an authentication error (401 OR network-level session expiry)
  if (error instanceof ApiError && (error.isUnauthorized() || error.code === 'AUTH_EXPIRED')) {
    // Prevent duplicate notifications
    if (hasShownAuthError) {
      return;
    }

    hasShownAuthError = true;

    // Show user-friendly message
    toast.error('Session expired. Signing you out…', {
      duration: 3000,
      id: 'auth-error',
    });

    // Save current path for redirect after login
    if (typeof window !== 'undefined') {
      const currentPath = window.location.pathname + window.location.search;
      if (currentPath !== '/auth' && currentPath !== '/') {
        sessionStorage.setItem('redirectAfterLogin', currentPath);
      }
    }

    // Sign out then hard redirect — await ensures session is cleared before reload
    const doRedirect = () => {
      if (typeof window !== 'undefined') {
        window.location.replace('/auth');
      }
    };

    if (supabase) {
      supabase.auth.signOut().finally(doRedirect);
    } else {
      doRedirect();
    }
  }
}
