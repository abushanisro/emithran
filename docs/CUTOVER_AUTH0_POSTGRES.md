# Running on Auth0 + Postgres + PostgREST + S3-compatible storage

The code runs on these only: **there is no Supabase mode and no switch** (the `DB_BACKEND`, `AUTH_BACKEND` and `STORAGE_BACKEND` flags were
removed with commit `fe08792b`, and `@supabase/supabase-js` is no longer a dependency). The backend verifies Auth0 access tokens, mints a
short-lived database token per request for PostgREST (`DB_JWT_SECRET`), and stores files in an S3-compatible bucket.

This is the order to stand up an environment, **stage first, then production**. Each step says how to know it worked. Section 1 is only for an
environment that still has data in an old Supabase project.

## 0. Provision (you)

**Auth0**
1. Tenant. Create an **API**: identifier = `AUTH0_AUDIENCE` (e.g. `https://api.emithran.com`), signing algorithm **RS256** (the backend accepts nothing else).
2. Create a **Regular Web Application**. Allowed Callback URL `<APP_BASE_URL>/auth/callback`, Allowed Logout URL `<APP_BASE_URL>`. Enable the
   database connection and **turn off sign-ups** on it (people are invited). **Do not enable the Google social connection** (or any other
   public social login): sign-in is company SSO or an invited database account only.
   Then authorize it for the API: **Applications → APIs → (the API) → Application Access**, set the web application's **User Access**
   to **Authorized**. Without this every sign-in is refused with `Client "…" is not authorized to access resource server "<AUTH0_AUDIENCE>"`.
   **Company SSO** is an Auth0 enterprise connection. For Google Workspace: in Google Cloud (project under the company's organisation),
   OAuth consent screen **Internal**, then a Web OAuth client with redirect URI `https://<AUTH0_DOMAIN>/login/callback`. In Auth0,
   Authentication → Enterprise → Google Workspace: purpose Authentication, the company domain, that client id and secret, Admin Directory
   API and extended attributes off, "Use ID instead of Email" on; enable it for the application. (Microsoft Entra ID or SAML work the same
   way through their own enterprise connection.) Set `NEXT_PUBLIC_AUTH0_SSO_CONNECTION` (build time) to the connection's name so
   "Sign in with SSO" goes straight to it; without it the app shows no SSO button. The Free plan includes one enterprise connection; Home
   Realm Discovery is not in Free.
3. Add a **post-login Action** so the access token carries what the backend reads (replace the namespace with your `AUTH0_CLAIM_NAMESPACE`):
   ```js
   exports.onExecutePostLogin = async (event, api) => {
     const ns = 'https://emithran.com/';
     api.accessToken.setCustomClaim(`${ns}email`, event.user.email);
     api.accessToken.setCustomClaim(`${ns}email_verified`, event.user.email_verified === true);
     api.accessToken.setCustomClaim(`${ns}sid`, event.session?.id ?? '');
     api.accessToken.setCustomClaim(`${ns}connection`, event.connection.name);
   };
   ```
   Without `sid` every login is refused (the inactivity timeout needs a session id). A new login links to an invited account only when
   all of these hold (migrations 938, 947): the email is verified, `connection` is in the backend's `AUTH0_TRUSTED_CONNECTIONS` (the
   company SSO connection and the database connection, decision D3), and the account has no login yet. Anything else is refused with
   the "not invited" screen and recorded in `auth.link_events`; a login that is already linked keeps working whatever its connection.
   Only these namespaced claims are read; plain `email`, `email_verified`, `sid` and `connection` claims are ignored.
4. **Branding, so Auth0's page matches the app's own sign-in page.** The app's `/auth` page keeps its design (logo, welcome text, image, "Sign In",
   "Sign in with SSO", "Request a demo") and its buttons lead to Auth0; the email and password boxes are on Auth0's page. In Auth0 Dashboard, Branding,
   Universal Login: upload the M logo, set the dark theme with the app's primary colour, and set the page title to eMithran. Leave sign-ups off so the
   "Request a demo" link remains the only way in.
5. Record: domain, client id, client secret, `AUTH0_SECRET` (`openssl rand -hex 32`).

**Postgres** (RDS, Cloud SQL, Azure, Neon...). Checklist before choosing:
- Can you create roles and give one `BYPASSRLS`? (`service_role` needs it; migration 930 creates it and says so if it cannot.)
- A **direct** (not pooled) connection for PostgREST, or `db-prepared-statements=false` behind a pooler.
- `pg_cron` available? If not (Neon), schedule `SELECT public.prune_old_rows(); SELECT public.prune_audit_events(); SELECT public.prune_job_queue();` nightly from `ops.yml`.
- TLS required; a private network path from the PostgREST container.

**Bucket** (S3, R2...). One bucket, one access key limited to it. No CORS needed (the browser never talks to storage; the backend signs URLs).
The Next.js file proxy fetches signed URLs, so add the bucket host to `TRUSTED_STORAGE_HOSTS`.

## 1. Load the database and the files

The database tools are read-only on the old database, refuse to touch a database that already has data, and are proven by `npm run test:baseline`
(a full round trip on two throwaway databases). A new, empty database cannot yet be built from migrations alone: it starts from a baseline.

1. `backend/scripts/baseline-dump.sh <old-db-url> <new-dir>`: the whole `public` schema (structure and data) plus the **user directory** (id and email only,
   no passwords or sessions). The directory is needed because 59 foreign keys point at `auth.users`; people are linked to their carried row by **verified
   email** at first Auth0 login (migration 931), which is how they keep their old ids and their data. Use the old project's session-pooler URL.
2. `backend/scripts/baseline-load.sh <new-dir> <new-db-url>`: checks SHA256SUMS, refuses a non-empty target, applies migration 930, loads the directory
   and the schema, then compares **every table's row count** with the dump. Run `restore-check.sh` on the nightly backup as a second opinion.
3. `npm run db:migrate -- --env stage`: applies the migrations newer than the baseline (918 onward, including 931 and 932).
4. Files: the Supabase Storage copy script (`storage:copy`) was removed with the Supabase client. If an old project still holds files, restore
   `backend/scripts/copy-storage.ts` from git history for that one run. The store-to-store copier it used, `src/common/storage/copy-objects.ts`
   (reads every object back and compares its hash), is still in the code.

## 2. Apply migrations (stage), in order

`930_postgres_compat` (roles, `auth` schema, `auth.uid()/role()/jwt()`), `931_identity_functions`, `932_user_directory`, plus any of 920, 922, 923 not yet applied.
Check: `npm run test:sql` is green locally first; on the new database `SELECT has_function_privilege('anon','public.link_identity(text,text,text,boolean,text,text[])','EXECUTE')` must be `false`.
Migration 947 replaces `link_identity` with the version that takes the connection and the allow-list: deploy the backend that passes
them right after it: in between, the old backend calls the removed 4-argument function and sign-in answers 503 (it never lets anyone in).
With the Rust assembly core (`--profile rust-core`): `951_cad_runner_role` before deploying it (the runner signs tokens for the `cad_runner` role, which
may only claim and finish uploads; without 951 PostgREST refuses its token). Check: `SELECT pg_has_role('authenticator','cad_runner','MEMBER')` is `true`.

## 3. Deploy (stage)

1. `env/stage.env`: `POSTGREST_DB_URI` (role `authenticator`), `DB_JWT_SECRET` (>= 32 chars, **the same value** for backend, PostgREST and `cad-runner`),
   `S3_*` (set `S3_ENDPOINT` for anything other than AWS), `AUTH0_DOMAIN`, `AUTH0_AUDIENCE`, `AUTH0_CLAIM_NAMESPACE`,
   `AUTH0_TRUSTED_CONNECTIONS` (e.g. `emithran-auth,Username-Password-Authentication`: the SSO connection, the same name as
   `NEXT_PUBLIC_AUTH0_SSO_CONNECTION`, and the database connection). Optional: `AUTH_DECISION_CACHE_SECONDS` (default 10, at most 60),
   the longest a person removed from `authorized_users` keeps access.
2. Frontend build: `AUTH0_DOMAIN`, `AUTH0_CLIENT_ID`, `AUTH0_CLIENT_SECRET`, `AUTH0_SECRET`, `AUTH0_AUDIENCE`, `APP_BASE_URL`.
3. `docker compose -p emithran-stage -f docker-compose.prod.yml --env-file env/stage.env --profile rust-core up -d --build` (PostgREST always runs).
   The profile starts two containers: `cad-core` (the runner, with the credentials) and `cad-worker` (parses the CAD; no credential, `network_mode: none`).
   They share only the `cad-worker-socket` volume. Check: `docker inspect <cad-worker> --format '{{.HostConfig.NetworkMode}}'` is `none`.
4. Check: `curl <stage>/api/health/live` is 200; `GET /api/v1/auth/me` without a token is 401. Locally the same wiring is proven by `npm run test:boot`.

## 4. People

Users start fresh (the user directory is carried by the baseline; Auth0 accounts are new). For each person, as `service_role`:
`SELECT public.provision_user('person@company.com', 'Full Name');`, then add the email to `authorized_users` (active) and to `organization_members`.
They sign in through Auth0; the first verified login from a trusted connection links to that row. Check: `/auth/me` returns their internal id; an uninvited Auth0 account gets the
"not invited" screen (403), not an error.

**A second login for the same person** (e.g. they used the database connection first and now use SSO) is never linked by email. After
checking with the person, as `service_role` or the database owner:
`SELECT public.admin_link_identity('<user uuid>', 'auth0', '<the new Auth0 sub, e.g. google-apps|123>', '<your email>');`
It refuses a login that belongs to someone else, and is recorded with your name. No email is sent to the person yet (no transactional
mail service exists); tell them yourself. **Every link decision** (allowed and denied, with the reason `first_login`, `admin_link`,
`unverified`, `untrusted_connection`, `not_invited` or `link_required`) is in `auth.link_events`, readable by the database owner only:
`SELECT at, outcome, reason, provider_id, connection, email, user_id, actor FROM auth.link_events ORDER BY at DESC LIMIT 50;`

**Roles (migration 944, decision D5).** `organization_members.role` is enforced by the API (`AuthzGuard`) and, where a policy decides, by the
database: `viewer` reads, `member` edits project data, `admin` (or `owner`) changes organization-wide settings (budget FX rates, API keys,
members, workspaces, forcing the delete of a part used in production lots). A person in several organizations acts with their lowest role
there. `/auth/me` returns `organizationRole` so the app hides what the API would refuse.

**Platform administrators (migration 943).** Platform-wide actions (`POST /fx/refresh`; the calibration history is read from the database) are for the
operators listed in `platform_admins`; no API role can read or change that table. Grant and revoke as the database owner, naming who granted:

```sql
INSERT INTO public.platform_admins (user_id, granted_by)
SELECT u.id, (SELECT id FROM auth.users WHERE email = 'operator-granting@company.com')
  FROM auth.users u WHERE u.email = 'new-operator@company.com';
DELETE FROM public.platform_admins WHERE user_id = (SELECT id FROM auth.users WHERE email = 'former-operator@company.com');
```

It takes effect on the person's next request (nothing is cached). Keep the list to the people on call.

## 5. Verify on stage (all of it, before production)

- The QA security tests (DB-RLS-01, DB-RLS-19, DB-RPC-02) against the new stack.
- Sign in, sign out, SSO sign-in, an uninvited account, 30 minutes idle (sign-out with the notice), a token without `sid` (refused).
- Upload a ZIP assembly: runner claims it (`cad_uploads` row goes queued, running, analysed, done), items appear, 3D viewer loads through a signed URL, original deleted.
- RFQ email with attachments; a drawing extraction; an electronics upload.
- Soak a few days. Then repeat 2 to 5 on production.

## 6. Rollback and what is one-way

There are no flags to flip back: returning to Supabase means redeploying a release from before commit `fe08792b`. **Data written after the move
exists only in the new database**, and Auth0 users do not exist in Supabase, so rolling back after real use loses that data unless it is copied
back. Keep any old Supabase project paused (not deleted) for at least one release after its data has moved.

## 7. After production is stable

Rotate every secret (including the 39 in git history, `.github/gitleaks-baseline.json`), and pause then delete the old Supabase projects.
The Supabase code paths and packages are already gone.

## Still open

The `ops.yml` storage-usage check and `db-size.sql`, Playwright login helpers for Auth0, and a from-scratch schema baseline (a new database
still starts from a dump). Avatar upload now goes through the backend to S3; delivery tracking and its realtime feed were removed (migration 934).
