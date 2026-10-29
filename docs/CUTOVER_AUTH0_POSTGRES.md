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
4. Record: domain, client id, client secret, `AUTH0_SECRET` (`openssl rand -hex 32`).

**Postgres** (RDS, Cloud SQL, Azure, Neon...). Checklist before choosing:
- Can you create roles and give one `BYPASSRLS`? (`service_role` needs it; migration 930 creates it and says so if it cannot.)
- A **direct** (not pooled) connection for PostgREST, or `db-prepared-statements=false` behind a pooler.
- `pg_cron` available? If not (Neon), schedule `SELECT public.prune_old_rows(); SELECT public.prune_audit_events(); SELECT public.prune_job_queue();` nightly from `ops.yml`.
- TLS required; a private network path from the PostgREST container.

**Bucket** (S3, R2...). One bucket, one access key limited to it. No CORS needed (the browser never talks to storage; the backend signs URLs).
The Next.js file proxy fetches signed URLs, so add the bucket host to `TRUSTED_STORAGE_HOSTS`.

## 1. Load the database (the one thing not built yet)

The **baseline extraction** (schema, reference data, storage objects from the old project) does not exist (`BASELINE.json` marks 917 as the baseline). Until it
does there is nothing to load into the new database beyond migrations 917 onward, which assume the older schema exists. **This blocks cutover.**
Do not improvise a dump: build the extraction tool, test the restore with `backend/scripts/restore-check.sh`, then continue.

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

Users start fresh (stage has 2 QA users, production none). For each person, as `service_role`:
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
