#!/usr/bin/env bash
# The whole local development stack, end to end, isolated from the real one (own compose project, ports and env file):
#   a source database -> baseline-dump -> local:load (restore, newer migrations, bucket, data API) -> checks against the live stack,
#   then local:use / local:restore on a throwaway .env. Needs Docker Desktop.     npm run test:local
set -euo pipefail
cd "$(dirname "$0")/../.."
TMP="$(mktemp -d)"; ID="localdata-$$"
export COMPOSE_PROJECT_NAME="emithran-localtest-$$" LOCAL_PG_PORT=54392 LOCAL_API_PORT=3091 LOCAL_S3_PORT=8393 LOCAL_ENV_FILE="$TMP/.env" LOCAL_BACKUP_DIR="$TMP"
cleanup() { bash scripts/local-data.sh reset --yes >/dev/null 2>&1 || true; docker rm -f "$ID-src" >/dev/null 2>&1 || true; docker network rm "$ID" >/dev/null 2>&1 || true; rm -rf "$TMP"; }
trap cleanup EXIT
IMAGE="postgres:17-alpine@sha256:266d3c257594e195b309ae9d1805e54c788f1d7b375f56bf6c367aac6c917e7b"
docker network create "$ID" >/dev/null
docker run -d --rm --name "$ID-src" --network "$ID" -e POSTGRES_PASSWORD=pw -v "$PWD/migrations":/migrations:ro -v "$PWD/test/sql":/sqltest:ro "$IMAGE" >/dev/null
for _ in $(seq 1 60); do docker exec "$ID-src" pg_isready -h 127.0.0.1 -U postgres >/dev/null 2>&1 && break; sleep 1; done
# The source looks like the real one just before the baseline: the shared stubs + migration 917 (everything up to the baseline number), plus tenant data.
docker exec -i "$ID-src" psql -U postgres -v ON_ERROR_STOP=1 -q <<'SQL' >/dev/null
\i /sqltest/00_stubs.sql
\i /migrations/917_cad_uploads.sql
ALTER TABLE auth.users ADD COLUMN email text UNIQUE, ADD COLUMN raw_user_meta_data jsonb NOT NULL DEFAULT '{}', ADD COLUMN created_at timestamptz NOT NULL DEFAULT now();
INSERT INTO auth.users (id, email) VALUES ('11111111-1111-4111-8111-111111111111','alice@example.com'),('22222222-2222-4222-8222-222222222222','bob@example.com');
DROP TABLE public.projects CASCADE;
CREATE TABLE public.projects (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL REFERENCES auth.users(id), name text);
INSERT INTO public.projects (user_id, name) VALUES ('11111111-1111-4111-8111-111111111111','Alice project');
ALTER TABLE public.projects ENABLE ROW LEVEL SECURITY;
CREATE POLICY own ON public.projects FOR SELECT TO authenticated USING (user_id = auth.uid());
SQL
# Same as stage/prod: the baseline is whatever the source holds; the stub auth.* functions are replaced by migration 930 on load.
DOCKER_NETWORK="$ID" bash scripts/baseline-dump.sh "postgres://postgres:pw@$ID-src:5432/postgres" "$TMP/baseline" | tail -1
printf 'ADMIN_FALLBACK_EMAIL=alice@example.com\nKEEP_ME=1\n' > "$TMP/.env"
bash scripts/local-data.sh load "$TMP/baseline" 2>&1 | tail -4
LOCAL_ENV_FILE="$TMP/.env" bash scripts/local-data.sh use >/dev/null
fail=0
for k in ALLOW_DEV_AUTH_BYPASS=true S3_FORCE_PATH_STYLE=true KEEP_ME=1; do grep -q "^$k$" "$TMP/.env" && echo "ok   .env has $k" || { echo "FAIL .env lacks $k"; fail=1; }; done
npx ts-node -r tsconfig-paths/register -r reflect-metadata test/local-data/smoke.ts || fail=1
# The real backend, built from source, in development mode against this stack, with NO Supabase setting at all (a clean copy of dist/, so the repo's .env cannot leak in).
npx nest build >/dev/null 2>&1
APP="$TMP/app/backend"; mkdir -p "$APP"; cp -r dist "$APP/dist"; cp package.json "$APP/"; ln -s "$PWD/node_modules" "$APP/node_modules"
( cd "$APP" && env -i PATH="$PATH" HOME="$HOME" NODE_ENV=development APP_ENV=local BACKEND_PORT=4529 CAD_UPLOAD_RUNNER=off ELECTRONICS_QUEUE_DRIVER=memory \
    POSTGREST_URL="http://127.0.0.1:$LOCAL_API_PORT" DB_JWT_SECRET="$(grep '^DB_JWT_SECRET=' "$TMP/.env" | cut -d= -f2-)" \
    S3_BUCKET=emithran S3_REGION=us-east-1 S3_ENDPOINT="http://127.0.0.1:$LOCAL_S3_PORT" S3_FORCE_PATH_STYLE=true S3_ACCESS_KEY_ID=test S3_SECRET_ACCESS_KEY=testtesttest \
    AUTH0_DOMAIN=t.eu.auth0.com AUTH0_AUDIENCE=https://api.example.com AUTH0_CLAIM_NAMESPACE=https://example.com/ \
    ALLOW_DEV_AUTH_BYPASS=true ADMIN_FALLBACK_EMAIL=alice@example.com node dist/main > "$TMP/backend.log" 2>&1 & echo $! > "$TMP/backend.pid" )
for _ in $(seq 1 90); do curl -s -o /dev/null http://127.0.0.1:4529/api/health/live && break; sleep 1; done
me="$(curl -s -m 10 http://127.0.0.1:4529/v1/api/auth/me)"
kill "$(cat "$TMP/backend.pid")" 2>/dev/null || true
if echo "$me" | grep -q '11111111-1111-4111-8111-111111111111'; then echo "ok   the backend runs in development on local Postgres with no Supabase and acts as the dev account (Alice)"; else echo "FAIL backend /auth/me: $me"; tail -5 "$TMP/backend.log"; fail=1; fi
bash scripts/local-data.sh restore >/dev/null
# `load` stores the generated DB_JWT_SECRET, so the saved copy legitimately has it. What matters: the person's own lines return and the switch is undone.
if grep -q '^KEEP_ME=1$' "$TMP/.env" && grep -q '^ADMIN_FALLBACK_EMAIL=alice@example.com$' "$TMP/.env" && ! grep -q '^POSTGREST_URL=' "$TMP/.env" && ! grep -q '^ALLOW_DEV_AUTH_BYPASS=' "$TMP/.env"; then
  echo "ok   local:restore brings the saved .env back and undoes the switch"
else echo "FAIL local:restore did not restore the saved .env"; fail=1; fi
exit $fail
