import { apiConfig } from '@/lib/api/config';

/**
 * Tells the API a sign-in just completed (POST /auth/sign-ins, server to server), with the new access token and the sign-in's ID
 * token, so it restarts the inactivity clock of the Auth0 session (Auth0 keeps the session id across a sign-in). Never blocks the
 * sign-in: a failure is logged and the person goes on (at worst they meet the old behaviour, one extra sign-in). Returns whether it took.
 */
export async function reportNewSignIn(accessToken: string | undefined, idToken: string | undefined, fetcher: typeof fetch = fetch): Promise<boolean> {
  if (!accessToken || !idToken) return false;
  try {
    const res = await fetcher(`${apiConfig.endpoints.api.v1}/auth/sign-ins`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ idToken }),
      cache: 'no-store',
      signal: AbortSignal.timeout(5_000),
    });
    if (!res.ok) console.error(`Sign-in: the API did not restart the session clock (${res.status})`);
    return res.ok;
  } catch (error) {
    console.error(`Sign-in: the API could not be reached to restart the session clock (${error instanceof Error ? error.message : String(error)})`);
    return false;
  }
}
