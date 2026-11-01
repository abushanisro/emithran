import { PostgrestClient } from '@supabase/postgrest-js';

/** The database client the backend hands out: PostgREST's own client, the `.from()` / `.rpc()` surface. */
export type DbClient = PostgrestClient;

/**
 * A database client for one token, pointed at a PostgREST reachable at `baseUrl` itself (no /rest/v1 prefix). PostgREST switches
 * to the role named in the token, so row-level security applies to whoever the token was minted for.
 */
export function createDbClient(baseUrl: string, token: string): DbClient {
  return new PostgrestClient(baseUrl.replace(/\/+$/, ''), { headers: { Authorization: `Bearer ${token}` } });
}
