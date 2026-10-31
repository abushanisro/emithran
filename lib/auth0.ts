import { Auth0Client, filterDefaultIdTokenClaims } from '@auth0/nextjs-auth0/server';
import { NextResponse } from 'next/server';

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
    // The BFF attaches the token to API calls on the server, so the route that would hand tokens to browser JavaScript is closed.
    enableAccessTokenEndpoint: false,
    // The browser's idle timer keys its shared state by session; with no token in the browser it reads the session id from the profile.
    beforeSessionSaved: (session) =>
      Promise.resolve({ ...session, user: { ...filterDefaultIdTokenClaims(session.user), sid: session.internal.sid } }),
    // A failed sign-in returns to the sign-in page with the SDK's short error code. Auth0's own message is logged here, not shown:
    // it names the client and the API, and the SDK's default would render it as a bare 500 page.
    // On success it goes back where sign-in started, and never off the app's origin (as the SDK's own default guards).
    onCallback: (error, ctx) => {
      const base = ctx.appBaseUrl ?? process.env.APP_BASE_URL;
      if (!error) {
        const target = new URL(ctx.returnTo ?? '/', base);
        return Promise.resolve(NextResponse.redirect(target.origin === new URL('/', base).origin ? target : new URL('/', base)));
      }
      console.error(`Auth0 sign-in failed (${error.code}): ${error.cause instanceof Error ? error.cause.message : error.message}`);
      return Promise.resolve(NextResponse.redirect(new URL(`/auth?error=${encodeURIComponent(error.code)}`, base)));
    },
  });
  return client;
}
