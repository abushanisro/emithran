# Deploying the security remediation (PRs #85 to #90, integrated)

One release, six workstreams. Do the steps in this order on stage first, run the checks, then repeat on production. Migrations are
idempotent and run in numeric order with `npm run db:migrate` (the runner applies them in that order; never skip one).

## 1. Before anything else

1. **Auth0 post-login Action** (workstream identity): the access token must carry the connection the login came from. Add this line
   to the Action in `docs/CUTOVER_AUTH0_POSTGRES.md` step 3 and deploy the Action:
   `api.accessToken.setCustomClaim(`${ns}connection`, event.connection.name);`
   Logins already linked keep working without it; a first login (or a second login for a person) is refused as `untrusted_connection` until it is there.
2. **Set the environment** (`env/stage.env`, `env/prd.env`; templates in `env/*.env.example`, descriptions in `env/README.md`):
   - Required, the backend refuses to start without them: `AUTH0_TRUSTED_CONNECTIONS` (comma-separated connection names: the company SSO
     connection and the database connection, e.g. `emithran-auth,Username-Password-Authentication`) and `BFF_FORWARD_SECRET`
     (`openssl rand -hex 32`; the same value reaches the frontend and the backend).
   - AI: `ANTHROPIC_API_KEY` (unset = AI answers 503); optional `AI_DISABLED`, `AI_USER_DAILY_TOKENS`, `AI_ORG_DAILY_TOKENS`,
     `AI_GLOBAL_DAILY_TOKENS`, `AI_MAX_CONCURRENT_PER_USER`.
   - Optional, defaults shown in the templates: `AUTH_DECISION_CACHE_SECONDS`, `ORG_THROTTLE_LIMIT`, `ORG_THROTTLE_TTL`,
     `ARCHIVE_MAX_EXPANDED_MB`, `HEAVY_WORK_MAX_CONCURRENT`, `HEAVY_WORK_MAX_PER_TENANT`, `FX_RATE_MAX_CHANGE_PERCENT`.
   - `TRUST_PROXY` stays `0` (set in `docker-compose.prod.yml`; never `true`).
3. **Decide who is read-only and who administers** (see section 3) before the backend that enforces roles goes out.

## 2. Migrations, in this order

| # | What | Needed by | Note |
|---|---|---|---|
| 943 | `platform_admins`, `is_platform_admin()` | the backend (platform-wide routes) | before the backend; without it those routes answer 503 |
| 944 | org settings (budget FX rates, API keys) need an org admin or owner | the backend | before the backend |
| 945 | `delete_bom_item_cascade` (admin forced delete) | the backend | before the backend |
| 947 | `link_identity` takes the connection and the allow-list; `auth.link_events` | the backend | removes the 4-argument function: deploy the new backend **right after it**; in between sign-in answers 503 (it never lets anyone in) |
| 948 | PMI reviewer email comes from the account | none | independent |
| 949 | `ai_usage_daily` (token budgets) | the backend | before the backend |
| 950 | copilot memory proposals | the backend | before the backend |
| 951 | `cad_runner` role | `--profile rust-core` only | **before** starting `cad-core`: without it PostgREST refuses the runner's token. Check `SELECT pg_has_role('authenticator','cad_runner','MEMBER')` is `true` |
| 952 | should-cost tracking tables in the lineage | `npm run should-cost:calibrate` | before 953 |
| 953 | calibration baseline | `npm run should-cost:calibrate` | after 952 |

Numbers 946 and 954 onward are not used by this release. Check on the new database: `npm run test:sql` is green locally first;
`SELECT has_function_privilege('anon','public.link_identity(text,text,text,boolean,text,text[])','EXECUTE')` is `false`.

## 3. Roles and platform administrators (migrations 943 and 944)

- **Who becomes read-only.** The API now enforces `organization_members.role`: `viewer` reads only; `member` edits project data and uses
  AI; `admin` and `owner` change organization-wide settings. A person in several organizations acts with their lowest role. Before
  deploying list who is a viewer and who should not be, and fix it on stage and production:
  `SELECT u.email, m.organization_id, m.role FROM organization_members m JOIN auth.users u ON u.id = m.user_id WHERE m.status = 'active' ORDER BY m.role;`
  Make sure every organization has at least one `admin` or `owner`: nobody else can set budget FX rates or issue API keys.
- **Platform administrators** (`POST /fx/refresh`; the calibration history is read from the database) are listed in `platform_admins`, empty after
  the migration, so nobody can use those routes until you insert the operators (as the database owner; `granted_by` names who granted):

  ```sql
  INSERT INTO public.platform_admins (user_id, granted_by)
  SELECT u.id, (SELECT id FROM auth.users WHERE email = 'operator-granting@company.com')
    FROM auth.users u WHERE u.email IN ('operator-one@company.com', 'operator-two@company.com');
  ```

## 4. Deploy

1. Apply migrations 943, 944, 945, then 947, 949, 950 (and 948), as one `db:migrate` run.
2. Deploy the backend and the frontend together (they share `BFF_FORWARD_SECRET`): `docker compose -f docker-compose.prod.yml --env-file env/<stage|prd>.env up -d --build`.
3. Rust assembly core only: apply 951 first, then add `--profile rust-core`. `cad-core` is on the `db` network only (it talks to PostgREST
   and the bucket); it is no longer on `edge`, so it cannot forge the Cloudflare client-address header to the backend.
4. Calibration (operator-run): 952 and 953 applied, then `npm run should-cost:calibrate`.
5. API keys and the developer portal are removed: migration 954 drops `api_keys` (any issued keys stop working for good, and
   they could not authenticate anything before 935 anyway). Apply 954 in the same `db:migrate` run, with the new backend.

## 5. Verify

`ci/all.sh release`; `/auth/me` returns `organizationRole`; a viewer's `POST` to a member route answers 403; an admin sets a budget FX
rate; a non-admin cannot; a listed platform admin can refresh FX rates (`POST /fx/refresh`) and an unlisted one gets 403;
`AI_DISABLED=true` makes `/copilot/chat` answer 503 and `false` restores it; `auth.link_events` shows the decision for a new login.

## Rollback

Migrations are additive except 947 (replaces `link_identity`) and the 944 policies (stricter). To roll the app back, redeploy the
previous images; the old backend calls the removed 4-argument `link_identity` and cannot sign in anyone new, so roll back the
database to 947's predecessor (restore `938`'s function) only together with the backend. Set `AI_DISABLED=true` to stop AI spend at once without a deploy of code.
