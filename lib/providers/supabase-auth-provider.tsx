'use client'

import { createContext, useContext, useEffect, useState, useCallback } from 'react'
import { toast } from 'sonner'
import { supabase } from '@/lib/supabase/client'

import type { User } from '@supabase/supabase-js'

interface AuthContextType {
  user: User | null
  loading: boolean
  signIn: (email: string, password: string) => Promise<{ error: Error | null }>
  signUp: (email: string, password: string, fullName?: string) => Promise<{ error: Error | null }>
  signInWithGoogle: () => Promise<{ error: Error | null }>
  signOut: () => Promise<void>
}

const AuthContext = createContext<AuthContextType | undefined>(undefined)

export function SupabaseAuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!supabase) {
      setLoading(false)
      return
    }

    // Get initial session
    const getInitialSession = async () => {
      try {
        const { data: { session } } = await supabase.auth.getSession()
        setUser(session?.user ?? null)
      } catch (error) {
        console.error('Error getting initial session:', error)
      } finally {
        setLoading(false)
      }
    }

    getInitialSession()

    // Listen for auth changes
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      async (_event, session) => {
        setUser(session?.user ?? null)
        setLoading(false)
      }
    )

    return () => subscription.unsubscribe()
  }, [])

  const signIn = useCallback(async (email: string, password: string) => {
    try {
      if (!supabase) {
        toast.error('Authentication is not configured.')
        return { error: new Error('Supabase not configured') }
      }

      const { data, error } = await supabase.auth.signInWithPassword({
        email,
        password,
      })

      if (error) {
        // Provide comprehensive user-friendly error messages
        if (error.message.includes('Email not confirmed')) {
          toast.error('Please confirm your email address first. Check your inbox for the confirmation link. If you cannot find it, please check your spam folder.', { duration: 10000 })
        } else if (error.message.includes('Invalid login credentials')) {
          toast.error('Invalid email or password. Please check your credentials and try again. If you forgot your password, please contact your administrator.')
        } else if (error.message.includes('Too many requests')) {
          toast.error('Too many failed sign-in attempts. Please wait a few minutes before trying again for security reasons.', { duration: 8000 })
        } else if (error.message.includes('User not found')) {
          toast.error('Account not found. Please check your email address or contact your administrator for access.')
        } else if (error.message.includes('network')) {
          toast.error('Network connection failed. Please check your internet connection and try again.')
        } else if (error.message.includes('timeout')) {
          toast.error('Sign-in request timed out. Please try again with a stable internet connection.')
        } else {
          toast.error(error.message || 'Sign-in failed. Please try again or contact support if the issue persists.', { duration: 6000 })
        }
        return { error: error as Error }
      }

      if (data.user) {
        toast.success('Welcome back!')
        return { error: null }
      }

      return { error: new Error('Login failed') }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'An unexpected error occurred'
      toast.error(errorMessage)
      return { error: error as Error }
    }
  }, [])

  const signUp = useCallback(async (email: string, password: string, fullName?: string) => {
    try {
      if (!supabase) {
        toast.error('Authentication is not configured.')
        return { error: new Error('Supabase not configured') }
      }

      const { data, error } = await supabase.auth.signUp({
        email,
        password,
        options: {
          data: {
            full_name: fullName,
          }
        }
      })

      if (error) {
        let errorMessage = 'Sign up failed. Please try again.'
        if (error.message.includes('already registered') || error.message.includes('already exists')) {
          errorMessage = 'An account with this email already exists. Please sign in instead or use a different email address.'
        } else if (error.message.includes('invalid email')) {
          errorMessage = 'Please enter a valid email address to create your account.'
        } else if (error.message.includes('password')) {
          errorMessage = 'Password must be at least 6 characters long and contain both letters and numbers.'
        } else if (error.message.includes('network')) {
          errorMessage = 'Network error during sign up. Please check your connection and try again.'
        } else {
          errorMessage = error.message || 'Sign up failed. Please try again.'
        }
        toast.error(errorMessage, { duration: 6000 })
        return { error: error as Error }
      }

      if (data.user) {
        toast.success('Account created! Please check your email to confirm your account.')
        return { error: null }
      }

      return { error: new Error('Sign up failed') }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'An unexpected error occurred'
      toast.error(errorMessage)
      return { error: error as Error }
    }
  }, [])

  const signInWithGoogle = useCallback(async () => {
    try {
      if (!supabase) {
        toast.error('Authentication is not configured.')
        return { error: new Error('Supabase not configured') }
      }

      const { error } = await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: {
          redirectTo: `${window.location.origin}/auth/callback`
        }
      })

      if (error) {
        let errorMessage = 'Google sign in failed. Please try again.'
        if (error.message.includes('popup')) {
          errorMessage = 'Google sign in popup was blocked. Please allow popups for this site and try again.'
        } else if (error.message.includes('cancelled') || error.message.includes('closed')) {
          errorMessage = 'Google sign in was cancelled. Please try again and complete the sign-in process.'
        } else if (error.message.includes('network')) {
          errorMessage = 'Network error during Google sign in. Please check your connection and try again.'
        } else if (error.message.includes('unauthorized')) {
          errorMessage = 'Google sign in failed: Your account is not authorized. Please use your company email or request access.'
        } else {
          errorMessage = error.message || 'Google sign in failed. Please try again.'
        }
        toast.error(errorMessage, { duration: 6000 })
        return { error: error as Error }
      }

      return { error: null }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'An unexpected error occurred'
      toast.error(errorMessage)
      return { error: error as Error }
    }
  }, [])

  const signOut = useCallback(async () => {
    try {
      if (!supabase) {
        return
      }

      const { error } = await supabase.auth.signOut()

      if (error) {
        let errorMessage = 'Sign out failed. Please try again.'
        if (error.message.includes('network')) {
          errorMessage = 'Network error during sign out. Please check your connection and try again.'
        } else {
          errorMessage = error.message || 'Sign out failed. Please try again.'
        }
        toast.error(errorMessage)
        return
      }

      toast.success('Signed out successfully')
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'An unexpected error occurred'
      toast.error(errorMessage)
    }
  }, [])

  const value = {
    user,
    loading,
    signIn,
    signUp,
    signInWithGoogle,
    signOut,
  }

  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  const context = useContext(AuthContext)
  if (context === undefined) {
    throw new Error('useAuth must be used within a SupabaseAuthProvider')
  }
  return context
}

export function useAuthReady() {
  const { loading } = useAuth()
  return !loading
}