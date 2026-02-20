'use client'

import { useEffect, Suspense } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { supabase } from '@/lib/supabase/client'
import { toast } from 'sonner'
import { Loader2 } from 'lucide-react'

function CallbackContent() {
  const router = useRouter()
  const searchParams = useSearchParams()

  useEffect(() => {
    const handleCallback = async () => {
      try {
        if (!supabase) {
          toast.error('Authentication service is not available. Please contact support if this issue persists.', { duration: 8000 })
          router.push('/auth')
          return
        }

        // The Supabase SSR client handles the code exchange automatically
        // Just check if we have a session
        const { data: { session }, error } = await supabase.auth.getSession()

        if (error) {
          let errorMessage = 'Authentication failed. Please try again.'
          if (error.message.includes('invalid_request')) {
            errorMessage = 'Authentication failed: Invalid request. Please try signing in again.'
          } else if (error.message.includes('access_denied')) {
            errorMessage = 'Authentication failed: Access denied. You may have cancelled the sign-in process.'
          } else if (error.message.includes('network')) {
            errorMessage = 'Authentication failed: Network error. Please check your connection and try again.'
          }
          toast.error(errorMessage, { duration: 6000 })
          router.push('/auth')
          return
        }

        if (session?.user) {
          // Check if user is authorized using the RPC function (enforced by RLS)
          try {
            const { data: isAuthorized, error: authError } = await supabase.rpc('is_user_authorized')

            if (authError) {
              // Fallback to manual check (though likely to fail if RLS blocks it)
              const { data: authData, error: queryError } = await supabase
                .from('authorized_users')
                .select('is_active')
                .eq('email', session.user.email)
                .limit(1)

              if (queryError) {
                let authErrorMsg = 'Unable to verify account access.'
                if (queryError.message.includes('permission')) {
                  authErrorMsg = 'Access verification failed: Insufficient permissions.'
                } else if (queryError.message.includes('network')) {
                  authErrorMsg = 'Access verification failed: Network error.'
                }
                throw new Error(authErrorMsg)
              }
              
              if (!(authData?.length > 0 && authData[0].is_active === true)) {
                 throw new Error('User not authorized (fallback check)')
              }
            } else if (!isAuthorized) {
              // User is not authorized according to RPC
              await supabase.auth.signOut()
              toast.error('Access denied. Please use your company email or request a demo.', { duration: 6000 })
              router.push('/auth')
              return
            }

            // User is authorized
            toast.success(`Welcome back! Successfully signed in as ${session.user.email}. Redirecting to your dashboard...`)
            router.push('/')
            router.refresh()
          } catch (authCheckError) {
            // Authorization check failed
            await supabase.auth.signOut()
            toast.error('Access denied. Please use your company email or request a demo.', { duration: 6000 })
            router.push('/auth')
          }
        } else {
          toast.error('Authentication failed: No valid session found. Please try signing in again.')
          router.push('/auth')
        }
      } catch (error: any) {
        console.error('Auth callback error:', error)
        let errorMessage = 'An unexpected error occurred during authentication.'
        if (error?.message) {
          if (error.message.includes('network')) {
            errorMessage = 'Network error during authentication. Please check your connection and try again.'
          } else if (error.message.includes('timeout')) {
            errorMessage = 'Authentication timeout. Please try signing in again.'
          } else {
            errorMessage = `Authentication error: ${error.message}`
          }
        }
        toast.error(errorMessage, { duration: 8000 })
        router.push('/auth')
      }
    }

    handleCallback()
  }, [router, searchParams])

  return (
    <div className="min-h-screen flex items-center justify-center bg-background">
      <div className="text-center">
        <Loader2 className="h-12 w-12 animate-spin text-primary mx-auto mb-4" />
        <h2 className="text-xl font-semibold text-foreground mb-2">Signing you in...</h2>
        <p className="text-muted-foreground">Please wait while we complete your authentication.</p>
      </div>
    </div>
  )
}

export default function AuthCallbackPage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen flex items-center justify-center bg-background">
        <Loader2 className="h-12 w-12 animate-spin text-primary" />
      </div>
    }>
      <CallbackContent />
    </Suspense>
  )
}
