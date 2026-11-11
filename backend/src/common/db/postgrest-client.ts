import { PostgrestClient } from '@supabase/postgrest-js';

/** The database client the backend hands out: PostgREST's own client, the `.from()` / `.rpc()` surface. */
export type DbClient = PostgrestClient;

/**
 * A database client for one token, pointed at a PostgREST reachable at `baseUrl` itself (no /rest/v1 prefix). PostgREST switches
 * to the role named in the token, so row-level security applies to whoever the token was minted for.
 *
 * `token` is either the token itself (a client that lives for one request) or a function that returns the CURRENT token, asked on
 * every request. A client that is kept (a job queue's, a poller's) must use the function: tokens live minutes, a kept client lives as
 * long as the process, and a fixed token turns every call into `JWT expired` once it ages out.
 */
export function createDbClient(baseUrl: string, token: string | (() => string)): DbClient {
  const url = baseUrl.replace(/\/+$/, '');
  if (typeof token === 'string') return new PostgrestClient(url, { headers: { Authorization: `Bearer ${token}` } });
  return new PostgrestClient(url, {
    fetch: (input, init) => {
      const headers = new Headers(init?.headers);
      headers.set('Authorization', `Bearer ${token()}`);
      return fetch(input, { ...init, headers });
    },
  });
}
