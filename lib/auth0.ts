import { Auth0Client, filterDefaultIdTokenClaims } from '@auth0/nextjs-auth0/server';

import { bffEnabled } from '@/lib/api/bff';

let client: Auth0Client | undefined;

/**
 * The one Auth0 SDK client (server only). Built on first use, so a deployment that does not use Auth0 never needs its settings.
 * Reads AUTH0_DOMAIN, AUTH0_CLIENT_ID, AUTH0_CLIENT_SECRET, AUTH0_SECRET and APP_BASE_URL from the environment.
 * The access token it keeps is for the eMithran API (AUTH0_AUDIENCE): the backend verifies it, the browser never sees the secret.
 */
export function getAuth0(): Auth0Client {
  const audience = process.env.AUTH0_AUDIENCE;
  if (!audience) throw new Error('AUTH0_AUDIENCE is not set: Auth0 would issue a token the backend cannot accept');
  client ??= new Auth0Client({
    authorizationParameters: {
      audience,
      scope: 'openid profile email offline_access',
    },
    // Auth0 never offers sign-up here: people are invited (the backend allow-list decides who gets in).
    signInReturnToPath: '/',
    // Behind the BFF the server attaches the token to API calls, so the route that hands tokens to browser JavaScript is closed.
    enableAccessTokenEndpoint: !bffEnabled,
    // The browser's idle timer keys its shared state by session; with no token in the browser it reads the session id from the profile.
    beforeSessionSaved: (session) =>
      Promise.resolve({ ...session, user: { ...filterDefaultIdTokenClaims(session.user), sid: session.internal.sid } }),
  });
  return client;
}
