#!/usr/bin/env bash
# The whole local development stack, end to end, isolated from the real one (own compose project, ports and env file):
#   a source database -> baseline-dump -> local:load (restore, newer migrations, bucket, data API) -> checks against the live stack,
#   then local:use / local:restore on a throwaway .env. Needs Docker Desktop.     npm run test:local
set -euo pipefail
cd "$(dirname "$0")/../.."
TMP="$(mktemp -d)"; ID="localdata-$$"
export COMPOSE_PROJECT_NAME="emithran-localtest-$$" LOCAL_PG_PORT=54392 LOCAL_API_PORT=3091 LOCAL_S3_PORT=8393 LOCAL_ENV_FILE="$TMP/.env" LOCAL_BACKUP_DIR="$TMP"
cleanup() { [ -f "$TMP/backend.pid" ] && kill "$(cat "$TMP/backend.pid")" >/dev/null 2>&1 || true; bash scripts/local-data.sh reset --yes >/dev/null 2>&1 || true; docker rm -f "$ID-src" >/dev/null 2>&1 || true; docker network rm "$ID" >/dev/null 2>&1 || true; rm -rf "$TMP"; }
trap cleanup EXIT
IMAGE="postgres:17-alpine@sha256:266d3c257594e195b309ae9d1805e54c788f1d7b375f56bf6c367aac6c917e7b"
docker network create "$ID" >/dev/null
docker run -d --rm --name "$ID-src" --network "$ID" -e POSTGRES_PASSWORD=pw -v "$PWD/migrations":/migrations:ro -v "$PWD/test/sql":/sqltest:ro "$IMAGE" >/dev/null
for _ in $(seq 1 60); do docker exec "$ID-src" pg_isready -h 127.0.0.1 -U postgres >/dev/null 2>&1 && break; sleep 1; done
# The source looks like the real one just before the baseline: the shared stubs + migration 917 (everything up to the baseline number), plus tenant data.
docker exec -i "$ID-src" psql -U postgres -v ON_ERROR_STOP=1 -q <<'SQL' >/dev/null
\i /sqltest/00_stubs.sql
-- the session table (migration 901, part of the baseline) as the real database has it; 901 references Supabase's auth.sessions,
-- which the real source has and the baseline load leaves out. Migration 1000 (logout ends the session) adds a column to it.
CREATE TABLE auth.sessions (id uuid PRIMARY KEY);
\i /migrations/901_user_session_activity.sql
\i /migrations/917_cad_uploads.sql
ALTER TABLE auth.users ADD COLUMN email text UNIQUE, ADD COLUMN raw_user_meta_data jsonb NOT NULL DEFAULT '{}', ADD COLUMN created_at timestamptz NOT NULL DEFAULT now();
INSERT INTO auth.users (id, email) VALUES ('11111111-1111-4111-8111-111111111111','alice@example.com'),('22222222-2222-4222-8222-222222222222','bob@example.com');
DROP TABLE public.projects CASCADE;
CREATE TABLE public.projects (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL REFERENCES auth.users(id), name text, organization_id uuid REFERENCES public.organizations(id));
-- what migrations after the baseline build on, as the real database has them (939 reads the team table)
CREATE TABLE public.project_team_members (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  user_id uuid NOT NULL, role text NOT NULL DEFAULT 'member', email text
);
-- the calculator tables as the real database has them (migrations 024, 100, 804), with the sand-casting catalog rows migration 851 seeds:
-- the calculator migrations after the baseline (956) create calculators and link them to these rows, and fail if a row is missing
CREATE TABLE public.calculators (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid, name text NOT NULL, calc_category text, calculator_type text,
  is_template boolean DEFAULT false, is_public boolean DEFAULT false, is_global boolean DEFAULT false, description text,
  retired_at timestamptz, updated_at timestamptz DEFAULT now(), version integer DEFAULT 1
);
CREATE TABLE public.calculator_fields (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), calculator_id uuid NOT NULL REFERENCES public.calculators(id) ON DELETE CASCADE,
  field_name text NOT NULL, display_label text, field_type text NOT NULL, unit text, data_source text, source_table text, source_field text,
  default_value text, display_order integer, is_required boolean DEFAULT false
);
CREATE TABLE public.process_calculator_mappings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), process_group varchar(255) NOT NULL, process_route varchar(255) NOT NULL, operation varchar(255) NOT NULL,
  calculator_id uuid REFERENCES public.calculators(id) ON DELETE CASCADE, calculator_name varchar(255), is_active boolean DEFAULT true,
  display_order integer DEFAULT 0, CONSTRAINT unique_process_calculator_mapping UNIQUE (process_group, process_route, operation)
);
INSERT INTO public.process_calculator_mappings (process_group, process_route, operation, is_active)
SELECT 'Sand Casting', n, n, false FROM unnest(ARRAY['Cleaning','CO2 Cured','Cooling','Core Refractory Coat','Degating','Finishing','Horizontal Automatic','Hot Box',
  'Isocure Gas','Manual Coremaking','Manual Floor Moldmaking','Manual Pit Moldmaking','Manual Std Moldmaking','Melting','Mold Refractory Coat','No Bake','Oil Core','Pour',
  'Refractory Coat Air Dry','Refractory Coat Oven Dry','Shakeout','Shell','Stock Core','Vertical Automatic','Visual Inspection']) AS n;
-- and the four Plastic Molding rows the older seed migrations create: migrations 975 and 976 link the molding cycle-time calculators to them and fail if one is missing
INSERT INTO public.process_calculator_mappings (process_group, process_route, operation, is_active)
SELECT 'Plastic Molding', n, n, true FROM unnest(ARRAY['Injection Molding','Structural foam molding','Compression Molding','Reaction Injection Molding']) AS n;
-- the catalog columns and the process taxonomy as the real database has them (migrations 367-371, 424, 725), and the four
-- secondary-operation calculators the baseline holds: migration 984 restores their catalog rows and fails if a calculator is missing
ALTER TABLE public.process_calculator_mappings ADD COLUMN machine_class varchar(100), ADD COLUMN applicable_families text[],
  ADD COLUMN lhr_process_group varchar(50), ADD COLUMN canonical_process_id uuid;
CREATE TABLE public.process_taxonomy (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), process_group varchar(255) NOT NULL, process_name varchar(255) NOT NULL, machine_class varchar(100),
  roadmap_status varchar(20), is_active boolean DEFAULT true, display_order integer DEFAULT 0, CONSTRAINT unique_process_taxonomy_row UNIQUE (process_group, process_name)
);
INSERT INTO public.calculators (id, name, is_global) VALUES
  ('edccd27a-c91c-479d-a440-d00053249a3a', 'Sheet Metal - Counterboring', true), ('0f7d6451-3937-472d-9a4c-3f8f3ebf59d8', 'Sheet Metal - Countersinking', true),
  ('72f84130-a741-425f-8fa9-9b027541801c', 'Sheet Metal - PEM Insertion', true), ('fe42139c-5675-4a82-94d5-7f2d440ae9bf', 'Machining - Tapping', true);
-- the materials table as the real database has it (migration 352 adds cut_code): migration 978 writes the cut code of the plastics onto it
CREATE TABLE public.raw_materials (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), name varchar(255) NOT NULL, cut_code decimal(10,2));
INSERT INTO public.raw_materials (name) VALUES ('Generic Nylon, Type 11 40% Glass');
-- the machine table (00_stubs.sql has it), plus the columns migration 981 reads and writes: a Black Oxide machine with no labor rate, and two machines of its wage grade that agree on one
ALTER TABLE public.mhr_records ADD COLUMN machine_class varchar(100), ADD COLUMN usd_labor_rate_per_hr numeric, ADD COLUMN usd_lhr_total numeric;
INSERT INTO public.mhr_records (machine_class, location, usd_labor_rate_per_hr, usd_lhr_total) VALUES
  ('surface_black_oxide', 'USA', NULL, NULL), ('surface_oven_cure', 'USA', 29.95, 29.95), ('surface_shot_blast', 'USA', 29.95, 29.95);
-- the machining reference table as the real database has it (migration 638): migration 1026 completes its tblTapping row from its tblReaming row
CREATE TABLE public.machining_reference_data (
  id serial PRIMARY KEY, category varchar(20) NOT NULL, source_region varchar(10) NOT NULL, source_version varchar(20) NOT NULL, key text NOT NULL,
  value text, unit_type text, notes text, raw jsonb, imported_at timestamptz DEFAULT now(), UNIQUE (category, source_region, source_version, key)
);
-- the process cost table as the real database has it (migration 034 on): migration 970 adds columns to it and redefines the function that fills it
CREATE TABLE public.process_cost_records (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), bom_item_id uuid, is_active boolean DEFAULT true, cycle_time numeric(12,2));
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
# A process already on the backend's port would answer for it (with a stack that no longer exists): refuse to run beside one.
if (exec 3<>/dev/tcp/127.0.0.1/4529) 2>/dev/null; then echo "FAIL port 4529 is already in use: stop that process and run again"; exit 1; fi
# The real backend, built from source, in development mode against this stack, with NO Supabase setting at all (a clean copy of dist/, so the repo's .env cannot leak in).
npx nest build >/dev/null 2>&1
APP="$TMP/app/backend"; mkdir -p "$APP"; cp -r dist "$APP/dist"; cp package.json "$APP/"; ln -s "$PWD/node_modules" "$APP/node_modules"
( cd "$APP" && exec env -i PATH="$PATH" HOME="$HOME" NODE_ENV=development APP_ENV=local BACKEND_PORT=4529 CAD_UPLOAD_RUNNER=off ELECTRONICS_QUEUE_DRIVER=memory \
    POSTGREST_URL="http://127.0.0.1:$LOCAL_API_PORT" DB_JWT_SECRET="$(grep '^DB_JWT_SECRET=' "$TMP/.env" | cut -d= -f2-)" \
    S3_BUCKET=emithran S3_REGION=us-east-1 S3_ENDPOINT="http://127.0.0.1:$LOCAL_S3_PORT" S3_FORCE_PATH_STYLE=true S3_ACCESS_KEY_ID=test S3_SECRET_ACCESS_KEY=testtesttest \
    AUTH0_DOMAIN=t.eu.auth0.com AUTH0_AUDIENCE=https://api.example.com AUTH0_CLAIM_NAMESPACE=https://example.com/ AUTH0_TRUSTED_CONNECTIONS=company-sso \
    ALLOW_DEV_AUTH_BYPASS=true ADMIN_FALLBACK_EMAIL=alice@example.com node dist/main ) > "$TMP/backend.log" 2>&1 & echo $! > "$TMP/backend.pid"
for _ in $(seq 1 90); do curl -s -o /dev/null http://127.0.0.1:4529/api/health/live && break; sleep 1; done
me="$(curl -s -m 10 http://127.0.0.1:4529/api/v1/auth/me)"
kill "$(cat "$TMP/backend.pid")" 2>/dev/null || true
if echo "$me" | grep -q '11111111-1111-4111-8111-111111111111'; then echo "ok   the backend runs in development on local Postgres with no Supabase and acts as the dev account (Alice)"; else echo "FAIL backend /auth/me: $me"; tail -5 "$TMP/backend.log"; fail=1; fi
bash scripts/local-data.sh restore >/dev/null
# `load` stores the generated DB_JWT_SECRET, so the saved copy legitimately has it. What matters: the person's own lines return and the switch is undone.
if grep -q '^KEEP_ME=1$' "$TMP/.env" && grep -q '^ADMIN_FALLBACK_EMAIL=alice@example.com$' "$TMP/.env" && ! grep -q '^POSTGREST_URL=' "$TMP/.env" && ! grep -q '^ALLOW_DEV_AUTH_BYPASS=' "$TMP/.env"; then
  echo "ok   local:restore brings the saved .env back and undoes the switch"
else echo "FAIL local:restore did not restore the saved .env"; fail=1; fi
exit $fail
