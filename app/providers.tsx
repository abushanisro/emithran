'use client'

import { useEffect } from 'react'
import { Toaster as Sonner } from '@/components/ui/sonner'
import { TooltipProvider } from '@/components/ui/tooltip'
import { ThemeProvider } from '@/lib/providers/theme-provider'
import { DensityProvider } from '@/lib/providers/density-provider'
import { QueryProvider } from '@/lib/providers/query-provider'
import { AuthProvider } from '@/lib/providers/auth-provider'
import { initializeApiClient } from '@/lib/api/init'
import { useCorrelationContext } from '@/lib/hooks/useCorrelationContext'

// nonce: the per-request CSP nonce (app/layout.tsx), for the theme script next-themes inlines before hydration.
export function Providers({ children, nonce }: { children: React.ReactNode; nonce?: string | undefined }) {
  // Initialize correlation context for request tracing (without auth dependency)
  useCorrelationContext();

  useEffect(() => {
    // Initialize API client with interceptors
    initializeApiClient()
  }, [])

  return (
    <ThemeProvider {...(nonce && { nonce })}>
      <DensityProvider>
        <AuthProvider>
          <QueryProvider>
            <TooltipProvider>
              {children}
              <Sonner />
            </TooltipProvider>
          </QueryProvider>
        </AuthProvider>
      </DensityProvider>
    </ThemeProvider>
  )
}
