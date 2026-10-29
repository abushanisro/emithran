/**
 * Who signs people in. `supabase` today; `auth0` once the tenant exists (build-time flag, so the other path is never shipped to the
 * browser). When Supabase is gone this file and every `usesAuth0` branch are deleted.
 */
export const usesAuth0 = process.env.NEXT_PUBLIC_AUTH_BACKEND === 'auth0';
