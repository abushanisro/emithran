'use client'

import { useUser } from '@auth0/nextjs-auth0'
import { useCallback, useEffect, useMemo, useState } from 'react'

import { browserAuthHeaders } from '@/lib/api/auth-headers'
import { apiConfig } from '@/lib/api/config'
import { sessionSource } from '@/lib/auth/session-source'
import { appReadiness } from '@/lib/core/app-readiness'
import { AuthContext, type AuthContextType, type AuthUser } from '@/lib/providers/auth-context'

type Me = { state: 'loading' } | { state: 'denied' } | { state: 'failed' } | { state: 'ok'; id: string; email: string }

/** Asks the backend who this login is. 403 means signed in with Auth0 but never invited. */
async function fetchMe(): Promise<Me> {
  const auth = await browserAuthHeaders()
  if (!auth) return { state: 'failed' }
  try {
    const res = await fetch(`${apiConfig.endpoints.api.v1}/auth/me`, { headers: auth, cache: 'no-store' })
    if (res.status === 403) return { state: 'denied' }
    if (!res.ok) return { state: 'failed' }
    const body = (await res.json()) as { data?: { id?: string; email?: string } }
    return body.data?.id ? { state: 'ok', id: body.data.id, email: body.data.email ?? '' } : { state: 'failed' }
  } catch {
    return { state: 'failed' }
  }
}

const go = (path: string) => {
  window.location.assign(path)
  return new Promise<never>(() => undefined)
}

/**
 * Auth0 sign-in (Universal Login: password, Google, MFA and password reset live there). The Auth0 session proves who the person is;
 * the backend decides whether they are invited and tells us their internal id, which is what the rest of the app uses.
 */
export function Auth0AuthProvider({ children }: { children: React.ReactNode }) {
  const { user: auth0User, isLoading } = useUser()
  const [me, setMe] = useState<Me>({ state: 'loading' })

  useEffect(() => {
    if (isLoading) return
    if (!auth0User) {
      setMe({ state: 'failed' })
      appReadiness.resetAuth()
      return
    }
    let cancelled = false
    void fetchMe().then((result) => {
      if (cancelled) return
      setMe(result)
      if (result.state === 'ok') appReadiness.setAuthValidated()
      else appReadiness.resetAuth()
    })
    return () => { cancelled = true }
  }, [auth0User, isLoading])

  const user = useMemo<AuthUser | null>(
    () => (me.state === 'ok' ? { id: me.id, email: me.email, user_metadata: { full_name: auth0User?.name ?? '', avatar_url: auth0User?.picture ?? '' } } : null),
    [me, auth0User],
  )

  const signIn = useCallback(async () => go('/auth/login'), [])
  const signInWithGoogle = useCallback(async () => go('/auth/login?connection=google-oauth2'), [])
  // People are invited by an administrator; there is no self-service sign-up.
  const signUp = useCallback(async () => ({ error: new Error('Accounts are created by invitation. Ask your administrator.') }), [])
  const signOut = useCallback(async () => { await sessionSource.signOutThisDevice() }, [])

  const value: AuthContextType = {
    user,
    loading: isLoading || (!!auth0User && me.state === 'loading'),
    accessDenied: me.state === 'denied',
    signIn,
    signUp,
    signInWithGoogle,
    signOut,
  }
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}
