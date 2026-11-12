/**
 * Auth0's login (password, MFA and password reset live there); credentials are never typed into this app. prompt=login: whoever clicks
 * a sign-in button is not signed in to the app, so Auth0 always asks, instead of silently reusing a leftover Auth0 session.
 */
const LOGIN = '/auth/login?prompt=login'

/** "Sign In": the email + password form only. Naming the database connection makes Auth0 leave out its social buttons. */
export const SIGN_IN_PATH = `${LOGIN}&connection=Username-Password-Authentication`

/**
 * "Sign in with SSO": straight to the SSO connection (Google, limited to company domains by an Auth0 Action), skipping Auth0's page.
 * Named at build time by NEXT_PUBLIC_AUTH0_SSO_CONNECTION. Blank means no SSO button.
 */
export function ssoSignInPath(connection = process.env.NEXT_PUBLIC_AUTH0_SSO_CONNECTION): string | null {
  const name = connection?.trim()
  return name ? `${LOGIN}&connection=${encodeURIComponent(name)}` : null
}
