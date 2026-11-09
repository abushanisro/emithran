'use client'

import { createContext, useContext } from 'react'

/** organization_members.role, least to most privileged (backend common/authz/org-role.ts). */
export type OrganizationRole = 'viewer' | 'member' | 'admin' | 'owner'

/** What the app knows about the signed-in person. `id` is always the internal user uuid. */
export interface AuthUser {
  id: string
  email?: string
  user_metadata?: { full_name?: string; avatar_url?: string; [key: string]: unknown }
  /** The role the person acts with (the API enforces it; the app only hides what it would refuse). Null without a membership. */
  organizationRole?: OrganizationRole | null
  /** Platform administrator (operators): platform-wide actions such as refreshing the reference FX snapshot. */
  platformAdmin?: boolean
}

/** Whether the person may change organization-wide settings (budget FX rates, API keys, members): an admin or the owner. */
export function isOrganizationAdmin(user: AuthUser | null | undefined): boolean {
  return user?.organizationRole === 'admin' || user?.organizationRole === 'owner'
}

export interface AuthContextType {
  user: AuthUser | null
  loading: boolean
  /** Signed in with the identity service but not invited to eMithran (backend answered 403). */
  accessDenied?: boolean
  /**
   * Signed in with the identity service, but the API could not answer who this is (not running, unreachable, 5xx). Not a sign-out:
   * sending the person to sign in again would only loop, so the app says so and keeps retrying.
   */
  serviceUnavailable?: boolean
  /**
   * Signed in with Auth0, but the API refused the login (401 not for inactivity, or another 4xx). Signing in again resumes the same Auth0
   * session and is refused again, so the app says so and offers sign-out.
   */
  loginRejected?: boolean
  /** Asks the API again now (used by the "server unreachable" screen). */
  retry?: () => void
  /** Leaves for Auth0's login page; credentials are never typed into this app. */
  signIn: () => Promise<never>
  /** Whether a company SSO connection is configured; the SSO button shows only then. */
  ssoAvailable: boolean
  /** Leaves for the company SSO connection (through Auth0). */
  signInWithSso: () => Promise<never>
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
