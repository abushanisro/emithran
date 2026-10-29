/**
 * The Supabase hosts the Content-Security-Policy must allow, taken from the configured project URL instead of being
 * written into the policy. A project move then needs no code change, and the policy names exactly one project (stage and
 * PRD each allow only their own) rather than every `*.supabase.co`.
 *
 * Pure and dependency-free so `next.config.ts` can import it by relative path.
 */

export interface SupabaseCspHosts {
  https: string
  wss: string
}

export function supabaseCspHosts(url: string | undefined): SupabaseCspHosts | null {
  if (!url) return null
  try {
    const { hostname, protocol } = new URL(url)
    if (!hostname || (protocol !== 'https:' && protocol !== 'http:')) return null
    return { https: `https://${hostname}`, wss: `wss://${hostname}` }
  } catch {
    return null
  }
}
