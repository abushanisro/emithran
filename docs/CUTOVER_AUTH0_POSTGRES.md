# Cutover: Supabase to Auth0 + managed Postgres + S3-compatible storage

Everything below is built and tested behind flags; the default (`supabase`) is unchanged. This is the order to turn it on, **stage first,
then production**. Each step says how to know it worked. Nothing here needs a code change.

| Flag | Values | Switches |
|---|---|---|
| `DB_BACKEND` | `supabase` / `postgrest` | all data access (backend, `cad-runner`) |
| `AUTH_BACKEND` (backend), `NEXT_PUBLIC_AUTH_BACKEND` (frontend, **build time**) | `supabase` / `auth0` | who signs people in |
| `STORAGE_BACKEND` | `supabase` / `s3` | where uploaded files live (backend, `cad-runner`) |

`AUTH_BACKEND=auth0` requires `DB_BACKEND=postgrest` (the database token is minted by the backend; Supabase would not accept it).

## 0. Provision (you)

**Auth0**
1. Tenant. Create an **API**: identifier = `AUTH0_AUDIENCE` (e.g. `https://api.emithran.com`), signing algorithm **RS256** (the backend accepts nothing else).
2. Create a **Regular Web Application**. Allowed Callback URL `<APP_BASE_URL>/auth/callback`, Allowed Logout URL `<APP_BASE_URL>`. Enable the
   Google social connection and the database connection; **turn off sign-ups** on the database connection (people are invited).
   **Company SSO (Google Workspace)** instead of the Google social connection: in Google Cloud (project under the company's organisation),
   OAuth consent screen **Internal**, then a Web OAuth client with redirect URI `https://<AUTH0_DOMAIN>/login/callback`. In Auth0,
   Authentication → Enterprise → Google Workspace: purpose Authentication, the company domain, that client id and secret, Admin Directory
   API and extended attributes off, "Use ID instead of Email" on; enable it for the application. Set
   `NEXT_PUBLIC_AUTH0_GOOGLE_CONNECTION` to the connection's name so "Sign in with Google" goes to it. The Free plan includes one
   enterprise connection; Home Realm Discovery is not in Free.
3. Add a **post-login Action** so the access token carries what the backend reads (replace the namespace with your `AUTH0_CLAIM_NAMESPACE`):
   ```js
   exports.onExecutePostLogin = async (event, api) => {
     const ns = 'https://emithran.com/';
     api.accessToken.setCustomClaim(`${ns}email`, event.user.email);
     api.accessToken.setCustomClaim(`${ns}email_verified`, event.user.email_verified === true);
     api.accessToken.setCustomClaim(`${ns}sid`, event.session?.id ?? '');
   };
   ```
   Without `sid` every login is refused (the inactivity timeout needs a session id). Without a verified email nobody can be linked to an existing user.
4. **Branding, so Auth0's page matches the app's own sign-in page.** The app's `/auth` page keeps its design (logo, welcome text, image, "Sign In",
   "Sign in with Google", "Request a demo") and its buttons lead to Auth0; the email and password boxes are on Auth0's page. In Auth0 Dashboard, Branding,
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

Both tools are read-only on the old project, refuse to touch a database that already has data, and are proven by `npm run test:baseline` (a full round trip
on two throwaway databases) and the unit tests of `copy-objects`.

1. `backend/scripts/baseline-dump.sh <old-db-url> <new-dir>`: the whole `public` schema (structure and data) plus the **user directory** (id and email only,
   no passwords or sessions). The directory is needed because 59 foreign keys point at `auth.users`; people are linked to their carried row by **verified
   email** at first Auth0 login (migration 931), which is how they keep their old ids and their data. Use the old project's session-pooler URL.
2. `backend/scripts/baseline-load.sh <new-dir> <new-db-url>`: checks SHA256SUMS, refuses a non-empty target, applies migration 930, loads the directory
   and the schema, then compares **every table's row count** with the dump. Run `restore-check.sh` on the nightly backup as a second opinion.
3. `npm run db:migrate -- --env stage`: applies the migrations newer than the baseline (918 onward, including 931 and 932).
4. Files: `npm run storage:copy` (dry run), then `npm run storage:copy -- --apply`. Needs `SUPABASE_URL`, `SUPABASE_SERVICE_KEY` and the `S3_*` settings.
   Every object is read back and its hash compared; repeat until it reports 0 to copy and 0 failed (it exits non-zero while anything failed).

## 2. Apply migrations (stage), in order

`930_postgres_compat` (roles, `auth` schema, `auth.uid()/role()/jwt()`), `931_identity_functions`, `932_user_directory`, plus any of 920, 922, 923 not yet applied.
Check: `npm run test:sql` is green locally first; on the new database `SELECT has_function_privilege('anon','public.link_identity(text,text,text,boolean)','EXECUTE')` must be `false`.

## 3. Deploy (stage)

1. `env/stage.env`: `DB_BACKEND=postgrest`, `POSTGREST_DB_URI` (role `authenticator`), `DB_JWT_SECRET` (>= 32 chars, **the same value** for backend, PostgREST and `cad-runner`),
   `STORAGE_BACKEND=s3` + `S3_*`, `AUTH_BACKEND=auth0`, `AUTH0_DOMAIN`, `AUTH0_AUDIENCE`, `AUTH0_CLAIM_NAMESPACE`.
2. Frontend build: `NEXT_PUBLIC_AUTH_BACKEND=auth0`, `AUTH0_DOMAIN`, `AUTH0_CLIENT_ID`, `AUTH0_CLIENT_SECRET`, `AUTH0_SECRET`, `AUTH0_AUDIENCE`, `APP_BASE_URL`.
3. `docker compose -p emithran-stage -f docker-compose.prod.yml --env-file env/stage.env --profile postgrest --profile rust-core up -d --build`.
4. Check: `curl <stage>/v1/api/health/live` is 200; `GET /v1/api/auth/me` without a token is 401. Locally the same wiring is proven by `npm run test:boot`.

## 4. People

Users start fresh (the user directory is carried by the baseline; Auth0 accounts are new). For each person, as `service_role`:
`SELECT public.provision_user('person@company.com', 'Full Name');`, then add the email to `authorized_users` (active) and to `organization_members`.
They sign in through Auth0; the first verified login links to that row. Check: `/auth/me` returns their internal id; an uninvited Auth0 account gets the
"not invited" screen (403), not an error.

## 5. Verify on stage (all of it, before production)

- The QA security tests (DB-RLS-01, DB-RLS-19, DB-RPC-02) against the new stack.
- Sign in, sign out, Google sign-in, an uninvited account, 30 minutes idle (sign-out with the notice), a token without `sid` (refused).
- Upload a ZIP assembly: runner claims it (`cad_uploads` row goes queued, running, analysed, done), items appear, 3D viewer loads through a signed URL, original deleted.
- RFQ email with attachments; a drawing extraction; an electronics upload.
- Soak a few days. Then repeat 2 to 5 on production.

## 6. Rollback and what is one-way

Flip the flags back and redeploy: Supabase is untouched until you decommission it. **Data written after cutover exists only in the new database**, and
Auth0 users do not exist in Supabase, so rolling back after real use loses that data unless it is copied back. Decide the point of no return
deliberately, keep Supabase paused (not deleted) for at least one release.

## 7. After production is stable

Delete the `supabase` branches (`usesAuth0`, `supabaseSource`, `SupabaseObjectStore`, the Supabase `Backend` in the runner, `@supabase/*` packages),
rotate every secret (including the 39 in git history, `.github/gitleaks-baseline.json`), and pause then delete the old Supabase projects.

## Still open (not blocking stage)

Avatar upload (still a direct browser upload to Supabase Storage), the `ops.yml` storage-usage check and `db-size.sql`, `DeliveryTracking` realtime
(becomes polling), Playwright login helpers for Auth0, and the delivery tables' missing tenancy/RLS.
