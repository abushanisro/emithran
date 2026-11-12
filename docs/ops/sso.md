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
   name `EMITHRAN sign-in`, Authorized redirect URIs `https://auth.emithran.com/login/callback` and
   `https://dev-ahu0oilgxwkz8hhf.us.auth0.com/login/callback` → keep the client ID and secret.
2. **Auth0** (`auth0 login` first): `DRY_RUN=1 infra/auth0/setup-company-google-sso.sh`, then without `DRY_RUN`. It asks for the client ID
   and secret (hidden), deploys the rule, attaches it before the existing `emithran-claims` Action, puts the key on the Google connection,
   and only then switches Google on for EMITHRAN Cloud and EMITHRAN Cloud (Stage).
3. **App settings**: in the three env files set `NEXT_PUBLIC_AUTH0_SSO_CONNECTION=google-oauth2` and
   `AUTH0_TRUSTED_CONNECTIONS=google-oauth2,emithran-auth,Username-Password-Authentication`. Local: restart `npm run dev` and the backend.
   Staging and production: `infra/oracle/stage-release.sh origin/develop`, then `infra/oracle/micro-release.sh origin/develop`.
4. **Invite** the people (`infra/oracle/authorize-user.sh`, production runbook). Being on an allowed domain is not enough on its own.

## Everyday
- Add a company: `ALLOWED_GOOGLE_DOMAINS=emithran.com,emuski.com,newco.com infra/auth0/setup-company-google-sso.sh` (no code change, no release),
  then invite its people.
- Turn SSO off: blank `NEXT_PUBLIC_AUTH0_SSO_CONNECTION` and release (no button), and switch the Google connection off for the apps in Auth0.
- A refused Google account comes back to the sign-in page with "Sign-in did not complete".
