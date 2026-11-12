/**
 * Auth0's login (password, MFA and password reset live there); credentials are never typed into this app. prompt=login: whoever clicks
 * a sign-in button is not signed in to the app, so Auth0 always asks, instead of silently reusing a leftover Auth0 session.
 */
export const SIGN_IN_PATH = '/auth/login?prompt=login'

/**
 * Auth0 login sent straight to the company SSO connection (an Auth0 enterprise connection), named at build time by
 * NEXT_PUBLIC_AUTH0_SSO_CONNECTION. Blank means no SSO button: there is no fallback to a public social login.
 */
export function ssoSignInPath(connection = process.env.NEXT_PUBLIC_AUTH0_SSO_CONNECTION): string | null {
  const name = connection?.trim()
  return name ? `${SIGN_IN_PATH}&connection=${encodeURIComponent(name)}` : null
}
