/**
 * Auth0 post-login Action "company-google-login" (docs/ops/sso.md). "Sign in with SSO" uses the Google connection, which any Google
 * account can use, so this lets a Google sign-in through only for a verified email at a company domain listed in the Action secret
 * ALLOWED_GOOGLE_DOMAINS (comma separated, e.g. "emithran.com,emuski.com"). No domain listed: every Google sign-in is refused.
 * Other connections (email + password) are untouched. The app's invite list still decides who gets in.
 *
 * Auth0 runs JavaScript only: infra/auth0/setup-company-google-sso.sh compiles this file to CommonJS when it uploads it.
 */

/** The parts of Auth0's post-login event and API this Action reads (Auth0 Actions, post-login trigger v3). */
export interface PostLoginEvent {
  connection: { strategy: string }
  user: { email?: string; email_verified?: boolean }
  secrets: { ALLOWED_GOOGLE_DOMAINS?: string }
}
export interface PostLoginApi {
  access: { deny: (reason: string) => void }
}

// Auth0 checks the handler is declared `async` (it refuses a plain function that returns a promise, and then EVERY sign-in fails).
// eslint-disable-next-line @typescript-eslint/require-await
export async function onExecutePostLogin(event: PostLoginEvent, api: PostLoginApi): Promise<void> {
  if (event.connection.strategy === 'google-oauth2' && !isCompanyEmail(event.user, event.secrets.ALLOWED_GOOGLE_DOMAINS ?? '')) {
    api.access.deny('Sign in with your company Google account.')
  }
}

function isCompanyEmail(user: PostLoginEvent['user'], domains: string): boolean {
  const allowed = domains.split(',').map((d) => d.trim().toLowerCase()).filter(Boolean)
  const domain = (user.email ?? '').toLowerCase().split('@')[1]
  return user.email_verified === true && domain !== undefined && allowed.includes(domain)
}
