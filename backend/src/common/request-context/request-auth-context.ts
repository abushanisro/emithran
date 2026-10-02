import { AsyncLocalStorage } from 'node:async_hooks';

/**
 * The authenticated caller of the current HTTP request, as established by
 * SupabaseAuthGuard. Held in AsyncLocalStorage so deep service code can obtain a
 * user-scoped (RLS-enforced) database client without every method threading a
 * token parameter, and without any path that can fall back to the service-role
 * client when the token is missing: no context means no client.
 */
export interface RequestAuth {
  accessToken: string;
  userId: string;
}

const storage = new AsyncLocalStorage<RequestAuth>();

export function runWithRequestAuth<T>(auth: RequestAuth, fn: () => T): T {
  return storage.run(auth, fn);
}

/** The current request's auth, or undefined outside an authenticated request. */
export function currentRequestAuth(): RequestAuth | undefined {
  return storage.getStore();
}
