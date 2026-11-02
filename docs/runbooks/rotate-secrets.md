# Rotate a secret

Use when a secret is leaked or suspected, when someone with access leaves, and once for every credential listed in
`.github/gitleaks-baseline.json` (they are in git history, so they must be treated as public). The general incident steps are in
[incident-response.md](../ops/incident-response.md#leaked-secret): revoke and replace first, then check the provider's logs.

Never paste a secret into a ticket, chat or commit. Generate new values on the operator's machine and put them only in the host env
file (`env/<env>.env`, mode 600), the GitHub Environment, or Vercel, as the table says.

## Inventory

| Secret | Where it is set | What uses it | Rotation |
|---|---|---|---|
| `DB_JWT_SECRET` | `env/<env>.env` on the host | backend (signs database tokens), `postgrest` (`PGRST_JWT_SECRET`), `cad-core` | [below](#db_jwt_secret) |
| `CAD_ENGINE_API_KEY`, `ECAD_ENGINE_API_KEY` | `env/<env>.env` | backend and the engine (shared secret) | [below](#engine-keys) |
| `ANTHROPIC_API_KEY` | Vercel project (web app, `lib/server/anthropic.ts`); `env/<env>.env` only where backend AI features run | Claude calls | [below](#provider-api-keys) |
| `GEMINI_API_KEY`, the Google Cloud API key | nowhere any more (only in old commits) | nothing in the current code | revoke at the provider, [below](#provider-api-keys) |
| Supabase JWT secret, `anon` / `service_role` keys (the `jwt` findings) | the old Supabase projects | legacy only, until the cutover ([CUTOVER_AUTH0_POSTGRES.md](../CUTOVER_AUTH0_POSTGRES.md)) | [below](#legacy-supabase-keys) |
| `AUTH0_CLIENT_SECRET`, `AUTH0_SECRET` | `env/<env>.env` / Vercel | web app sign-in and session cookie | Auth0 dashboard: rotate the client secret; new `AUTH0_SECRET` (`openssl rand -hex 32`) signs everyone out |
| `MIGRATE_DATABASE_URL`, `POSTGREST_DB_URI`, `SCHEMA_READER_DATABASE_URL` | `env/<env>.env`, GitHub Environments | migrations, PostgREST, nightly ops | `ALTER ROLE <role> PASSWORD '<new>'` as the database owner, then update every place that holds the URL |
| `S3_ACCESS_KEY_ID` / `S3_SECRET_ACCESS_KEY` | `env/<env>.env` | backend, cad-core | create a second key on the bucket, deploy, delete the old key |

The findings in `gitleaks-baseline.json` that are placeholders or documentation examples (`setup-axis-rule.spec.ts`,
`lib/docs/specs/authentication.ts`, `auth.controller.ts`, `*.md`, `.env.example`) are not credentials; everything committed in
`.env.development`, `.env.production`, `.env.prod`, `cad-engine/.env.*` and `docker-compose.prod.yml` is, and must be revoked.

## DB_JWT_SECRET

One secret: the backend signs every database token with it and PostgREST accepts only tokens signed with it. Tokens live 5 minutes
(`DbTokenMinter`). Changing it on all three services at once invalidates every outstanding token, so expect a few seconds of failed
requests while the containers restart; do it in a quiet hour, stage first.

1. Generate: `openssl rand -hex 32` (at least 32 characters; the backend refuses a shorter one).
2. Replace `DB_JWT_SECRET=` in `env/<env>.env` on the host.
3. Recreate the three services that read it, together:
   ```bash
   docker compose -p emithran-<env> -f docker-compose.prod.yml --env-file env/<env>.env up -d --force-recreate backend postgrest
   # and, if the rust-core profile is enabled:
   docker compose -p emithran-<env> -f docker-compose.prod.yml --env-file env/<env>.env --profile rust-core up -d --force-recreate cad-core
   ```
4. Verify: `curl -s https://<host>/api/health/ready` reports the database ok; sign in and open a project. A token signed with the old
   secret is now refused by PostgREST (`npm run test:postgrest` proves this behaviour on a throwaway stack).
5. Nothing else holds it: it is never in GitHub, Vercel or the browser.

## Engine keys

`CAD_ENGINE_API_KEY` / `ECAD_ENGINE_API_KEY` are shared between the backend and one engine. Generate (`openssl rand -hex 32`), set in
`env/<env>.env`, recreate the backend and that engine together (`up -d --force-recreate backend cad-engine`). Verify an upload
analyses. The values committed in `cad-engine/.env.development` / `.env.production` are dead once the env file holds a new one; make
sure no host still uses them.

## Provider API keys

Anthropic, Gemini and Google Cloud keys are revoked at the provider, not in the app:

1. Anthropic Console → API keys: create a new key, then **disable and delete** every key that was ever committed. Google Cloud
   console → APIs & Services → Credentials: delete the leaked API key (and the Gemini key in AI Studio). The current code uses no
   Google key; do not create a replacement.
2. Put the new Anthropic key in Vercel (Production and Preview separately) and, where the backend's AI features run, in
   `env/<env>.env`; redeploy / recreate the backend.
3. Check the provider's usage page for spend between the leak and the revocation. Unexplained use is a data incident.

To stop AI spend at once while you do this, see [disable-ai.md](disable-ai.md).

## Legacy Supabase keys

The `jwt` findings are Supabase `anon` / `service_role` keys (JWTs signed with the project's JWT secret). A `service_role` key
bypasses row-level security on that project. While an old project still holds data: Supabase dashboard → Project Settings → API →
**JWT Settings → Generate a new JWT secret** (this invalidates every key signed with the old one), then disable the legacy API keys.
After the cutover, pause or delete the old projects.

## After any rotation

Record it in the incident timeline (who, when, which secret, verified how). If the secret was committed, it stays in git history:
rotation is the fix, not a rewrite of history.
