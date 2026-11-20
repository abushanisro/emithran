import { Auth0Client } from '@auth0/nextjs-auth0/server';
import { NextResponse } from 'next/server';

import { reportNewSignIn } from '@/lib/server/new-sign-in';

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
      // With max_age the ID token always carries auth_time (OIDC): the API restarts the idle clock only for a sign-in it can see is new.
      // 8 hours, the sign-in's own limit below, so nobody is asked to authenticate more often than they already are.
      max_age: 8 * 60 * 60,
    },
    // Auth0 never offers sign-up here: people are invited (the backend allow-list decides who gets in).
    signInReturnToPath: '/',
    // No rolling session: rolling re-writes the session cookie on every request, so API calls still in flight at "Log out" answered
    // after it and wrote the cookie back (the person stayed signed in). Idle sign-out is the app's own (30 minutes, enforced by the
    // server: lib/auth/session-idle). A sign-in lasts at most 8 hours, one working day (decision 2026-11-12), then the person signs in again.
    session: { rolling: false, absoluteDuration: 8 * 60 * 60 },
    // The BFF attaches the token to API calls on the server, so the route that would hand tokens to browser JavaScript is closed.
    enableAccessTokenEndpoint: false,
    // The session cookie goes with every request, so the profile in it keeps only what the app reads: name and picture for the header,
    // sub as the identity, and the session id the browser's idle timer keys on (it has no token to read it from). Email, role and
    // organization come from the backend (/me). The tokens all stay: the access token calls the API, the refresh token renews it
    // (it lasts 1 hour), and the ID token lets Auth0 log out without asking the person to confirm.
    beforeSessionSaved: (session) => {
      const { sub, name, picture } = session.user;
      return Promise.resolve({ ...session, user: { sub, ...(name != null && { name }), ...(picture != null && { picture }), sid: session.internal.sid } });
    },
    // A failed sign-in returns to the sign-in page with the SDK's short error code. Auth0's own message is logged here, not shown:
    // it names the client and the API, and the SDK's default would render it as a bare 500 page.
    // On success it goes back where sign-in started, and never off the app's origin (as the SDK's own default guards).
    onCallback: async (error, ctx, session) => {
      const base = ctx.appBaseUrl ?? process.env.APP_BASE_URL;
      if (!error) {
        // Auth0 keeps its session id across a sign-in, so the API would still hold the idle clock of the last visit and refuse this
        // sign-in's first request (the person was signed out and had to sign in twice). Report the new sign-in first: the clock restarts.
        await reportNewSignIn(session?.tokenSet.accessToken, session?.tokenSet.idToken);
        const target = new URL(ctx.returnTo ?? '/', base);
        return NextResponse.redirect(target.origin === new URL('/', base).origin ? target : new URL('/', base));
      }
      console.error(`Auth0 sign-in failed (${error.code}): ${error.cause instanceof Error ? error.cause.message : error.message}`);
      return NextResponse.redirect(new URL(`/auth?error=${encodeURIComponent(error.code)}`, base));
    },
  });
  return client;
}
