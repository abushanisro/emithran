'use client'

import Image from 'next/image'
import { useEffect } from 'react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { consumeInactivitySignOutNotice } from '@/lib/auth/session-idle/browser'
import { useAuth } from '@/lib/providers/auth'

/** The sign-in page when Auth0 signs people in: the form itself is Auth0's Universal Login, so this is one button. */
export function Auth0SignIn() {
  const { signIn, signOut, accessDenied, loading } = useAuth()

  useEffect(() => {
    if (consumeInactivitySignOutNotice()) {
      toast.info('You were signed out after 30 minutes of inactivity. Sign in to continue where you left off.', { duration: 8000 })
    }
  }, [])

  return (
    <main className="flex min-h-screen items-center justify-center px-4">
      <div className="w-full max-w-sm space-y-6 text-center">
        <Image src="/M.svg" alt="eMithran" width={100} height={100} className="mx-auto" priority />
        {accessDenied ? (
          <>
            <p role="alert" className="text-sm text-muted-foreground">
              Your account has not been invited to eMithran. Ask your administrator for access, or sign in with another account.
            </p>
            <Button className="w-full" variant="outline" onClick={() => void signOut()}>Use another account</Button>
          </>
        ) : (
          <Button className="w-full" disabled={loading} onClick={() => void signIn('', '')}>Sign in</Button>
        )}
      </div>
    </main>
  )
}
