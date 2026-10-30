import { sessionSource } from '@/lib/auth/session-source';

import { bffEnabled } from './bff';

/**
 * Authorization for a browser request that cannot go through apiClient (raw fetch for files, streams and the idle heartbeat).
 * Behind the BFF it is empty: the session cookie travels with the same-origin request and the server attaches the token. Without the
 * BFF it is the session's bearer token, or null when there is no session, so callers skip the request instead of sending "Bearer null".
 */
export async function browserAuthHeaders(): Promise<Record<string, string> | null> {
  if (bffEnabled) return {};
  const token = await sessionSource.getAccessToken();
  return token ? { Authorization: `Bearer ${token}` } : null;
}
