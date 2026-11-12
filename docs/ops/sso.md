# Sign in with SSO (company Google accounts)

"Sign in with SSO" opens Google's account chooser. An Auth0 rule lets through only verified emails at the company domains
(`emithran.com`, `emuski.com`); every other Google account is refused at Auth0. The app's invite list (`public.authorized_users`) then
decides who gets in, exactly as for email + password.

Why this design: it costs $0. Auth0's Free plan allows one enterprise connection and has no email-first routing (Home Realm Discovery);
one Google Workspace connection per company needs B2B Essentials ($150/month). The Google social connection plus a domain rule gives
the same result for any number of companies.

| Piece | Where |
|---|---|
| Domain rule | Auth0 Action `company-google-login`, source `infra/auth0/company-google-login.ts` (tested in `test/auth0/`), secret `ALLOWED_GOOGLE_DOMAINS` |
| Google sign-in key | Google Cloud project of emithran.com, OAuth client "EMITHRAN sign-in" |
| Button | `NEXT_PUBLIC_AUTH0_SSO_CONNECTION=google-oauth2` (build time) in `.env`, `env/stage.env`, `~/emithran-prod-run/env/prd.env` |
| Account linking | `google-oauth2` in `AUTH0_TRUSTED_CONNECTIONS` (backend), so a Google login joins the person's invited account |

## Set it up (once)
1. **Google key** (console.cloud.google.com, signed in as the emithran.com admin; about 10 minutes, free):
   new project `emithran-sign-in` → Google Auth Platform → Branding: app name `EMITHRAN`, support email → Audience: **External**, then
   **Publish app** (only name, email and profile are asked for, so Google needs no review) → Clients → Create client → Web application,
   name `EMITHRAN sign-in`, Authorized redirect URI `https://auth.emithran.com/login/callback` only → keep the client ID and secret. Every environment signs in
   through the custom domain (`AUTH0_DOMAIN=auth.emithran.com`), never `*.auth0.com`, so Google shows our domain and can verify our brand.
2. **Auth0** (`auth0 login` first): `DRY_RUN=1 infra/auth0/setup-company-google-sso.sh`, then without `DRY_RUN`. It asks for the client ID
   and secret (hidden), deploys the rule, attaches it before the existing `emithran-claims` Action, puts the key on the Google connection,
   and only then switches Google on for EMITHRAN Cloud and EMITHRAN Cloud (Stage).
3. **App settings**: in the three env files set `NEXT_PUBLIC_AUTH0_SSO_CONNECTION=google-oauth2` and
   `AUTH0_TRUSTED_CONNECTIONS=google-oauth2,emithran-auth,Username-Password-Authentication`. Local: restart `npm run dev` and the backend.
   Staging and production: `infra/oracle/stage-release.sh origin/develop`, then `infra/oracle/micro-release.sh origin/develop`.
4. **Invite** the people (`infra/oracle/authorize-user.sh`, production runbook). Being on an allowed domain is not enough on its own.

## Google shows "EMITHRAN" (brand verification, free, once)
Until Google verifies the brand, its account chooser names a domain ("to continue to …") instead of EMITHRAN. In Google Auth Platform:
1. Branding: app name `EMITHRAN`, support email, logo (120x120, optional), home page `https://www.emithran.com`, privacy policy
   `https://www.emithran.com/privacy`, terms `https://www.emithran.com/terms`, authorised domain `emithran.com` only.
2. Clients → EMITHRAN sign-in: the only redirect URI is `https://auth.emithran.com/login/callback`.
3. emithran.com verified in Google Search Console for the same Google account (a DNS TXT record in Cloudflare).
4. Verification centre → submit brand verification. Google answers in a few business days; nothing changes for users while it waits.

## Everyday
- Add a company: `ALLOWED_GOOGLE_DOMAINS=emithran.com,emuski.com,newco.com infra/auth0/setup-company-google-sso.sh` (no code change, no release),
  then invite its people.
- Turn SSO off: blank `NEXT_PUBLIC_AUTH0_SSO_CONNECTION` and release (no button), and switch the Google connection off for the apps in Auth0.
- A refused Google account comes back to the sign-in page with "Sign-in did not complete".
- Google always shows its account chooser (`upstream_params.prompt=select_account` on the Google connection, set by the script). Logging out of
  the app does not log anyone out of Google (it would also end their Gmail); the chooser is how someone switches to another company account.

## Session policy (decision 2026-11-12)
| Rule | Where |
|---|---|
| Idle sign-out after 30 minutes, enforced by the server per Auth0 session. **Switched off in every environment today** (`SESSION_IDLE_TIMEOUT_ENABLED=false`, decision of 2026-11-04) | backend `common/session` (`user_session_activity`) |
| Logout ends the session on the server (a copied cookie is refused at once), whether the idle sign-out is on or off | `POST /api/v1/auth/session/end`, migration 1000 |
| A sign-in lasts at most 8 hours, then sign in again | `lib/auth0.ts` (`session.absoluteDuration`), and the refresh token's lifetime |
| The session cookie is never re-written by ordinary requests (a late response cannot undo a logout) | `lib/auth0.ts` (`session.rolling: false`) |
| Refresh tokens rotate and expire after 8 hours; access tokens last 1 hour; code flow only | Auth0: `infra/auth0/apply-session-policy.sh` (`DRY_RUN=1` first; rerunnable) |
| Cookies are `Secure; HttpOnly; SameSite=lax` in production | the Auth0 SDK (https `APP_BASE_URL`) |
