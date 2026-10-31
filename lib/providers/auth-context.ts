'use client'

import { createContext, useContext } from 'react'

/** What the app knows about the signed-in person. `id` is always the internal user uuid. */
export interface AuthUser {
  id: string
  email?: string
  user_metadata?: { full_name?: string; avatar_url?: string; [key: string]: unknown }
}

export interface AuthContextType {
  user: AuthUser | null
  loading: boolean
  /** Signed in with the identity service but not invited to eMithran (backend answered 403). */
  accessDenied?: boolean
  /** Leaves for Auth0's login page; credentials are never typed into this app. */
  signIn: () => Promise<never>
  signInWithGoogle: () => Promise<never>
  signOut: () => Promise<void>
}

export const AuthContext = createContext<AuthContextType | undefined>(undefined)

export function useAuth(): AuthContextType {
  const context = useContext(AuthContext)
  if (context === undefined) throw new Error('useAuth must be used within an AuthProvider')
  return context
}

export function useAuthReady() {
  const { loading } = useAuth()
  return !loading
}
