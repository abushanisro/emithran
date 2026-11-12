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
