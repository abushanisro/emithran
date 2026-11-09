'use client'

import { useUser } from '@auth0/nextjs-auth0'
import { useCallback, useEffect, useMemo, useState } from 'react'

import { apiConfig } from '@/lib/api/config'
import { devAuthBypassEnabled } from '@/lib/auth/dev-bypass'
import { signOutForInactivity } from '@/lib/auth/session-idle/browser'
import { isSessionIdleBody } from '@/lib/auth/session-idle/policy'
import { sessionSource } from '@/lib/auth/session-source'
import { appReadiness } from '@/lib/core/app-readiness'
import { AuthContext, type AuthContextType, type AuthUser, type OrganizationRole } from '@/lib/providers/auth-context'

type Me =
  | { state: 'loading' }
  | { state: 'denied' }
  | { state: 'idle' }
  | { state: 'unavailable' }
  | { state: 'failed' }
  | { state: 'ok'; id: string; email: string; organizationRole: OrganizationRole | null; platformAdmin: boolean }

/**
 * Asks the backend who this login is, and the role it acts with. 403 means signed in with Auth0 but never invited. A 401 for
 * inactivity means this Auth0 session is past its idle deadline for good (the deadline never moves): it has to be ended at Auth0,
 * or "Sign in" silently resumes the same session and is refused again.
 */
async function fetchMe(): Promise<Me> {
  try {
    const res = await fetch(`${apiConfig.endpoints.api.v1}/auth/me`, { cache: 'no-store' })
    if (res.status === 403) return { state: 'denied' }
    if (res.status === 401) {
      if (isSessionIdleBody(await res.json().catch(() => null))) return { state: 'idle' }
    }
    // 5xx: the BFF could not reach the API (502), or the API could not check the login (503). The login itself may be fine.
    if (res.status >= 500) return { state: 'unavailable' }
    if (!res.ok) return { state: 'failed' }
    const body = (await res.json()) as {
      data?: { id?: string; email?: string; organizationRole?: OrganizationRole | null; platformAdmin?: boolean }
    }
    const me = body.data
    return me?.id
      ? { state: 'ok', id: me.id, email: me.email ?? '', organizationRole: me.organizationRole ?? null, platformAdmin: me.platformAdmin === true }
      : { state: 'failed' }
  } catch {
    // The request never got an answer (the app server itself is down or the network dropped): nothing says the login is bad.
    return { state: 'unavailable' }
  }
}

/** How often the app asks again while the API is unreachable, so it continues on its own once the API is back. */
const UNAVAILABLE_RETRY_MS = 5_000

/**
 * The company single sign-on connection (an Auth0 enterprise connection: Google Workspace, Microsoft Entra ID, SAML, ...), named at build
 * time by NEXT_PUBLIC_AUTH0_SSO_CONNECTION. Unset means no SSO button: there is no fallback to a public social login, so only the
 * company directory can sign people in this way.
 */
export function ssoConnection(value = process.env.NEXT_PUBLIC_AUTH0_SSO_CONNECTION): string | null {
  const name = value?.trim()
  return name ? name : null
}

/** Auth0 login sent straight to the company SSO connection, skipping the Auth0 login form. */
export function ssoSignInPath(connection: string): string {
  return `/auth/login?connection=${encodeURIComponent(connection)}`
}

const go = (path: string) => {
  window.location.assign(path)
  return new Promise<never>(() => undefined)
}

/**
 * Auth0 sign-in (Universal Login: password, company SSO, MFA and password reset live there). The Auth0 session proves who the person is;
 * the backend decides whether they are invited and tells us their internal id, which is what the rest of the app uses.
 */
export function Auth0AuthProvider({ children }: { children: React.ReactNode }) {
  const { user: auth0User, isLoading } = useUser()
  const [me, setMe] = useState<Me>({ state: 'loading' })
  const [attempt, setAttempt] = useState(0)
  const retry = useCallback(() => { setAttempt((n) => n + 1) }, [])

  useEffect(() => {
    if (me.state !== 'unavailable') return
    const timer = setTimeout(retry, UNAVAILABLE_RETRY_MS)
    return () => { clearTimeout(timer) }
  }, [me, retry])

  useEffect(() => {
    if (isLoading) return
    // Local development bypass: no Auth0 session is needed, the API says who this is (its configured dev account).
    if (!auth0User && !devAuthBypassEnabled()) {
      setMe({ state: 'failed' })
      appReadiness.resetAuth()
      return
    }
    // A new look at a signed-in person starts from 'loading', so a stale 'failed' (from before sign-in) never flashes the rejected screen.
    setMe((prev) => (prev.state === 'ok' || prev.state === 'unavailable' ? prev : { state: 'loading' }))
    let cancelled = false
    void fetchMe().then((result) => {
      if (cancelled) return
      // The idle timer only runs while a tab is open; after a sleep or a closed browser, this is where the expired session is found.
      if (result.state === 'idle') {
        appReadiness.resetAuth()
        void signOutForInactivity()
        return
      }
      setMe(result)
      if (result.state === 'ok') appReadiness.setAuthValidated()
      else appReadiness.resetAuth()
    })
    return () => { cancelled = true }
  }, [auth0User, isLoading, attempt])

  const user = useMemo<AuthUser | null>(
    () =>
      me.state === 'ok'
        ? {
            id: me.id,
            email: me.email,
            user_metadata: { full_name: auth0User?.name ?? '', avatar_url: auth0User?.picture ?? '' },
            organizationRole: me.organizationRole,
            platformAdmin: me.platformAdmin,
          }
        : null,
    [me, auth0User],
  )

  const signIn = useCallback(async () => go('/auth/login'), [])
  const sso = ssoConnection()
  const signInWithSso = useCallback(async () => {
    if (!sso) throw new Error('Single sign-on is not configured (NEXT_PUBLIC_AUTH0_SSO_CONNECTION)')
    return go(ssoSignInPath(sso))
  }, [sso])
  const signOut = useCallback(async () => { await sessionSource.signOutThisDevice() }, [])

  const value: AuthContextType = {
    user,
    loading: isLoading || ((!!auth0User || devAuthBypassEnabled()) && me.state === 'loading'),
    accessDenied: me.state === 'denied',
    serviceUnavailable: !!auth0User && me.state === 'unavailable',
    loginRejected: !!auth0User && me.state === 'failed',
    retry,
    signIn,
    ssoAvailable: sso !== null,
    signInWithSso,
    signOut,
  }
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}
