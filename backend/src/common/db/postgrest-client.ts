import { PostgrestClient } from '@supabase/postgrest-js';
import type { SupabaseClient } from '@supabase/supabase-js';

// What a plain PostgREST cannot do: the rest of supabase-js (auth, file storage, realtime, edge functions) is Supabase's own service.
// Code that still reaches for them gets a clear error naming the replacement, instead of an undefined
// property deep inside a handler.
const REPLACED: Record<string, string> = {
  auth: 'IdentityService (login is Auth0; user lookups are the auth.users table)',
  storage: 'ObjectStore (files are in the S3-compatible bucket)',
  functions: 'a backend endpoint (there are no Supabase edge functions)',
  channel: 'polling (there is no realtime server)',
  realtime: 'polling (there is no realtime server)',
};

/**
 * A database client for one token: the same `.from()` / `.rpc()` surface the code already uses (it IS supabase-js's own PostgREST
 * client), pointed at a PostgREST that is reachable at `baseUrl` itself (no /rest/v1 prefix) and authenticated by `token`.
 */
export function createDbClient(baseUrl: string, token: string): SupabaseClient {
  const rest = new PostgrestClient(baseUrl.replace(/\/+$/, ''), { headers: { Authorization: `Bearer ${token}`, apikey: token } });
  return new Proxy(rest, {
    get(target, property, receiver) {
      if (typeof property === 'string' && property in REPLACED && !(property in target)) {
        throw new Error(`supabase.${property} is not available (there is no Supabase): use ${REPLACED[property]}`);
      }
      return Reflect.get(target, property, receiver) as unknown;
    },
  }) as unknown as SupabaseClient;
}
