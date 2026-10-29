/**
 * The one place the frontend reads its Supabase connection settings.
 *
 * Supabase's new API keys are called publishable keys (`sb_publishable_...`); the old ones were the anon JWT
 * (`eyJ...`). The new name wins and the old one is still read, so a build keeps working until the previous project is
 * retired. Each name is written out literally: Next.js inlines `NEXT_PUBLIC_*` values into the browser bundle only for
 * a static `process.env.NAME`, never for `process.env[name]`.
 */

export function supabaseUrl(): string {
  return process.env.NEXT_PUBLIC_SUPABASE_URL ?? ''
}

export function supabasePublishableKey(): string {
  const publishable = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
  const legacy = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  // An empty value counts as unset, so a blank new variable does not hide a real legacy one.
  const key = [publishable, legacy].find((candidate) => candidate) ?? ''
  assertNotASecretKey(key)
  return key
}

/**
 * A NEXT_PUBLIC_* value is compiled into the JavaScript every visitor downloads. A secret key placed there (an easy slip
 * when copying from the Supabase dashboard) would hand full database access, past every row-level-security policy, to the
 * whole internet. So it stops the app instead of shipping.
 */
export function assertNotASecretKey(key: string): void {
  if (key.startsWith('sb_secret_') || isServiceRoleJwt(key)) {
    throw new Error(
      'A Supabase secret (service-role) key was found in a NEXT_PUBLIC_ variable, which is sent to every browser. ' +
        'Use the publishable key (sb_publishable_...) there and keep the secret key on the server only.',
    )
  }
}

function isServiceRoleJwt(key: string): boolean {
  const payload = key.split('.')[1]
  if (!key.startsWith('eyJ') || !payload) return false
  try {
    const json = atob(payload.replace(/-/g, '+').replace(/_/g, '/'))
    return (JSON.parse(json) as { role?: unknown }).role === 'service_role'
  } catch {
    return false
  }
}

/** True for a key Supabase issues: the new `sb_publishable_` form or the legacy anon JWT. */
export function isSupabaseKeyFormat(key: string): boolean {
  return key.startsWith('sb_publishable_') || key.startsWith('eyJ')
}
