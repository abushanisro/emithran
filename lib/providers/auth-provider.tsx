'use client'

import { usesAuth0 } from '@/lib/auth/backend'
import { Auth0AuthProvider } from '@/lib/providers/auth0-auth-provider'
import { SupabaseAuthProvider } from '@/lib/providers/supabase-auth-provider'

/** The one provider the app mounts. */
export const AuthProvider = usesAuth0 ? Auth0AuthProvider : SupabaseAuthProvider
