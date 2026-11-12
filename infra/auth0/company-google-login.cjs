/**
 * Auth0 post-login Action "company-google-login" (deploy: docs/ops/sso.md). "Sign in with SSO" uses the Google connection, which any
 * Google account can use, so this lets a Google sign-in through only for a verified email at a company domain listed in the Action
 * secret ALLOWED_GOOGLE_DOMAINS (comma separated, e.g. "emithran.com,emuski.com"). No domain listed: every Google sign-in is refused.
 * Other connections (email + password) are untouched. The app's invite list still decides who gets in.
 */
exports.onExecutePostLogin = async (event, api) => {
  if (event.connection.strategy !== 'google-oauth2') return;
  const allowed = (event.secrets.ALLOWED_GOOGLE_DOMAINS || '').split(',').map((d) => d.trim().toLowerCase()).filter(Boolean);
  const domain = (event.user.email || '').toLowerCase().split('@')[1];
  if (event.user.email_verified !== true || !allowed.includes(domain)) {
    api.access.deny('Sign in with your company Google account.');
  }
};
