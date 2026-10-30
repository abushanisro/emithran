import { getAccessToken as getAuth0AccessToken } from '@auth0/nextjs-auth0'

import { bffEnabled } from '@/lib/api/bff'
import { usesAuth0 } from '@/lib/auth/backend'
import { sessionIdFromAccessToken } from '@/lib/auth/session-idle/policy'
import { supabase } from '@/lib/supabase/client'

/**
 * The browser's session, behind one small interface, so the API client and the inactivity timer do not know who signs people in.
 * `getAccessToken` is bounded: every API request awaits it, so it must never hang.
 */
export interface SessionSource {
  getAccessToken(): Promise<string | null>
  /** A fresh token after the backend said 401, or null when the person must sign in again. */
  refresh(): Promise<{ token: string; expiresInSeconds: number } | null>
  /** Ends THIS device's session only. */
  signOutThisDevice(): Promise<void>
  /** Tells the caller which session is current (its id changes on a new sign-in, not on token refresh). */
  onSessionChange(listener: (sessionId: string | null) => void): () => void
}

const TOKEN_WAIT_MS = 5_000
const withTimeout = <T>(work: Promise<T>, fallback: T): Promise<T> =>
  Promise.race([work, new Promise<T>((resolve) => setTimeout(() => resolve(fallback), TOKEN_WAIT_MS))])

const supabaseSource: SessionSource = {
  async getAccessToken() {
    if (!supabase) return null
    try {
      // supabase-js queues every session call behind one lock; a wedged call would freeze every request, hence the bound.
      const session = await withTimeout(supabase.auth.getSession().then((r) => r.data.session), null)
      return session?.access_token ?? null
    } catch {
      return null
    }
  },
  async refresh() {
    if (!supabase) return null
    try {
      const { data: { session }, error } = await supabase.auth.refreshSession()
      return !error && session?.access_token ? { token: session.access_token, expiresInSeconds: session.expires_in || 3600 } : null
    } catch {
      return null
    }
  },
  async signOutThisDevice() {
    await withTimeout(supabase.auth.signOut({ scope: 'local' }).then(() => undefined), undefined)
  },
  onSessionChange(listener) {
    const { data } = supabase.auth.onAuthStateChange((_event, session) => {
      listener(session?.access_token ? sessionIdFromAccessToken(session.access_token) : null)
    })
    return () => data.subscription.unsubscribe()
  },
}

/** Behind the BFF the browser has no token; the session id comes from the profile instead (lib/auth0.ts keeps it there). */
async function auth0ProfileSessionId(): Promise<string | null> {
  try {
    const res = await fetch('/auth/profile', { cache: 'no-store', signal: AbortSignal.timeout(TOKEN_WAIT_MS) })
    if (!res.ok) return null
    const profile = (await res.json()) as { sid?: unknown }
    return typeof profile.sid === 'string' ? profile.sid : null
  } catch {
    return null
  }
}

const auth0Source: SessionSource = {
  async getAccessToken() {
    // The server attaches the token through the BFF, and the SDK's /auth/access-token route is closed (lib/auth0.ts).
    if (bffEnabled) return null
    try {
      // The SDK asks our own /auth/access-token route; the server refreshes the token when it is about to expire.
      return (await withTimeout(getAuth0AccessToken(), null)) || null
    } catch {
      return null
    }
  },
  async refresh() {
    const token = await auth0Source.getAccessToken()
    return token ? { token, expiresInSeconds: 300 } : null
  },
  async signOutThisDevice() {
    // Leaving through Auth0's logout ends the session everywhere on this browser, which is the expected meaning of "sign out".
    window.location.assign('/auth/logout')
    await new Promise(() => undefined)
  },
  onSessionChange(listener) {
    let last: string | null | undefined
    const currentId = async () => {
      if (bffEnabled) return auth0ProfileSessionId()
      const token = await auth0Source.getAccessToken()
      return token ? sessionIdFromAccessToken(token) : null
    }
    const check = async () => {
      const id = await currentId()
      if (id !== last) {
        last = id
        listener(id)
      }
    }
    void check()
    window.addEventListener('focus', check)
    return () => window.removeEventListener('focus', check)
  },
}

export const sessionSource: SessionSource = usesAuth0 ? auth0Source : supabaseSource
