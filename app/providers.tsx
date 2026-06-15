'use client'

import { useEffect } from 'react'
import { Toaster as Sonner } from '@/components/ui/sonner'
import { TooltipProvider } from '@/components/ui/tooltip'
import { ThemeProvider } from '@/lib/providers/theme-provider'
import { DensityProvider } from '@/lib/providers/density-provider'
import { QueryProvider } from '@/lib/providers/query-provider'
import { SupabaseAuthProvider } from '@/lib/providers/supabase-auth-provider'
import { initializeApiClient } from '@/lib/api/init'
import { useCorrelationContext } from '@/lib/hooks/useCorrelationContext'
import { PageContextProvider } from '@/lib/echo/PageContextProvider'
import { EchoProvider, EchoWidget } from '@/components/features/echo'
import { useAuth } from '@/lib/providers/supabase-auth-provider'

function AuthenticatedEchoWidget() {
  const { user } = useAuth()
  if (!user) return null
  return <EchoWidget />
}

export function Providers({ children }: { children: React.ReactNode }) {
  // Initialize correlation context for request tracing (without auth dependency)
  useCorrelationContext();

  useEffect(() => {
    // Initialize API client with interceptors
    initializeApiClient()
  }, [])

  return (
    <ThemeProvider>
      <DensityProvider>
        <SupabaseAuthProvider>
          <QueryProvider>
            <TooltipProvider>
              <PageContextProvider>
                <EchoProvider>
                  {children}
                  <AuthenticatedEchoWidget />
                </EchoProvider>
              </PageContextProvider>
              <Sonner />
            </TooltipProvider>
          </QueryProvider>
        </SupabaseAuthProvider>
      </DensityProvider>
    </ThemeProvider>
  )
}
