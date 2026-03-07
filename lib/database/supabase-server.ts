/**
 * Supabase Server Client
 *
 * Server-side Supabase client with admin privileges for API routes
 */

import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || ''
const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY || ''

// Fallback to anon key if service role key is not available (for development)
const serverKey = supabaseServiceRoleKey || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || ''

// Admin client for server-side operations
export const supabaseAdmin = createServerClient(
  supabaseUrl,
  serverKey,
  {
    cookies: {
      getAll() {
        return []
      },
      setAll() {
        // No-op for admin client
      },
    },
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    }
  }
)

// Server client for authenticated operations
export function createServerSupabaseClient() {
  const cookieStore = cookies()

  return createServerClient(
    supabaseUrl,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '',
    {
      cookies: {
        getAll() {
          return cookieStore.getAll()
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options)
            )
          } catch {
            // The `setAll` method was called from a Server Component.
            // This can be ignored if you have middleware refreshing
            // user sessions.
          }
        },
      },
    }
  )
}

// Retry utility for database operations
export async function withRetry<T>(
  operation: () => Promise<T>,
  maxRetries: number = 3,
  delayMs: number = 1000
): Promise<T> {
  let lastError: Error

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await operation()
    } catch (error) {
      lastError = error as Error
      
      // Don't retry on certain error types
      if (error && typeof error === 'object' && 'code' in error) {
        const pgError = error as { code: string }
        // Don't retry on authentication, authorization, or validation errors
        if (pgError.code === 'PGRST301' || // JWT expired
            pgError.code === 'PGRST302' || // JWT invalid
            pgError.code === 'PGRST116' || // Not found
            pgError.code?.startsWith('23')) { // Constraint violations
          throw error
        }
      }

      if (attempt === maxRetries) {
        break
      }

      // Exponential backoff
      const delay = delayMs * Math.pow(2, attempt - 1)
      await new Promise(resolve => setTimeout(resolve, delay))
    }
  }

  throw lastError!
}

// Helper to check if server Supabase is configured
export const isServerSupabaseConfigured = () => {
  return !!(supabaseUrl && serverKey)
}