/**
 * The browser's Auth0 session, as far as browser code needs it. Browser code never holds an access token: API calls go same-origin
 * through the BFF (/api/v1), where the Next.js server attaches it.
 */
export interface SessionSource {
  /** Ends this browser's session. */
  signOutThisDevice(): Promise<void>
  /** Tells the caller which session is current (its id changes on a new sign-in, not on token refresh). */
  onSessionChange(listener: (sessionId: string | null) => void): () => void
}

const PROFILE_WAIT_MS = 5_000

/** The session id from the profile, which lib/auth0.ts keeps there for the idle timer; null when signed out. */
async function profileSessionId(): Promise<string | null> {
  try {
    const res = await fetch('/auth/profile', { cache: 'no-store', signal: AbortSignal.timeout(PROFILE_WAIT_MS) })
    if (!res.ok) return null
    const profile = (await res.json()) as { sid?: unknown }
    return typeof profile.sid === 'string' ? profile.sid : null
  } catch {
    return null
  }
}

export const sessionSource: SessionSource = {
  async signOutThisDevice() {
    // Leaving through Auth0's logout ends the session everywhere on this browser, which is the expected meaning of "sign out".
    window.location.assign('/auth/logout')
    await new Promise(() => undefined)
  },
  onSessionChange(listener) {
    let last: string | null | undefined
    const check = async () => {
      const id = await profileSessionId()
      if (id !== last) {
        last = id
        listener(id)
      }
    }
    const onFocus = () => {
      void check()
    }
    onFocus()
    window.addEventListener('focus', onFocus)
    return () => {
      window.removeEventListener('focus', onFocus)
    }
  },
}
