/**
 * Supabase Client
 *
 * Initializes and exports the Supabase client for browser usage
 */

import { createBrowserClient } from '@supabase/ssr'

import { supabasePublishableKey, supabaseUrl as readSupabaseUrl } from './env'

import type { SupabaseClient } from '@supabase/supabase-js'


const supabaseUrl = readSupabaseUrl()
const supabaseAnonKey = supabasePublishableKey()

// Only create client if credentials are provided
let supabaseClient: SupabaseClient | null = null

if (supabaseUrl && supabaseAnonKey) {
  supabaseClient = createBrowserClient(supabaseUrl, supabaseAnonKey)
}

export const supabase = supabaseClient!

// Helper to check if Supabase is configured
export const isSupabaseConfigured = () => supabaseClient !== null
