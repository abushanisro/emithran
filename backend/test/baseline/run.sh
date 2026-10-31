#!/usr/bin/env bash
# Round trip of the baseline tooling on two throwaway Postgres databases (needs Docker):
#   source (users, data, RLS) -> baseline-dump.sh -> baseline-load.sh -> an empty target
# and then what the cutover actually depends on: same ids, foreign keys intact, row-level security still isolating users, a carried
# user linkable by verified email (migration 931), and the loader refusing to touch a database that already has data.
#   npm run test:baseline        (from backend/)
set -euo pipefail
cd "$(dirname "$0")/../.."
IMAGE="postgres:17-alpine@sha256:266d3c257594e195b309ae9d1805e54c788f1d7b375f56bf6c367aac6c917e7b"
ID="baseline-$$"; WORK="$(mktemp -d)"
cleanup() { docker rm -f "$ID-src" "$ID-dst" "$ID-dst2" >/dev/null 2>&1 || true; docker network rm "$ID" >/dev/null 2>&1 || true; rm -rf "$WORK"; }
trap cleanup EXIT
docker network create "$ID" >/dev/null
start() { docker run -d --rm --name "$ID-$1" --network "$ID" -e POSTGRES_PASSWORD=pw -v "$PWD/migrations":/migrations:ro "$IMAGE" >/dev/null; }
for n in src dst dst2; do start $n; done
for n in src dst dst2; do for _ in $(seq 1 60); do docker exec "$ID-$n" pg_isready -h 127.0.0.1 -U postgres >/dev/null 2>&1 && break; sleep 1; done; done
sql() { docker exec -i "$ID-$1" psql -U postgres -v ON_ERROR_STOP=1 -At -q "${@:2}"; }
url() { echo "postgres://postgres:pw@$ID-$1:5432/postgres"; }
fail=0
check() { if [ "$2" = "$3" ]; then echo "ok   $1"; else echo "FAIL $1 (wanted '$2', got '$3')"; fail=1; fi; }

# --- the source: auth users, tenant data with RLS, awkward values -------------------------------------------------------------------
sql src <<'SQL' >/dev/null
\i /migrations/930_postgres_compat.sql
INSERT INTO auth.users (id, email, raw_user_meta_data) VALUES
  ('11111111-1111-4111-8111-111111111111', 'Alice@Example.com', '{"full_name":"Alice A"}'),
  ('22222222-2222-4222-8222-222222222222', 'bob@example.com', '{}'),
  ('33333333-3333-4333-8333-333333333333', 'carol@example.com', '{"full_name":"Carol, \"C\""}');
CREATE TABLE public.projects (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL REFERENCES auth.users(id), name text, tags text[], meta jsonb, created_at timestamptz DEFAULT now());
INSERT INTO public.projects (user_id, name, tags, meta) VALUES
  ('11111111-1111-4111-8111-111111111111', 'Alice''s "bracket"', '{a,b}', '{"k":[1,2,{"x":null}]}'),
  ('11111111-1111-4111-8111-111111111111', E'multi\nline, with comma', '{}', NULL),
  ('22222222-2222-4222-8222-222222222222', 'Bob''s part', NULL, '{}');
ALTER TABLE public.projects ENABLE ROW LEVEL SECURITY;
CREATE POLICY own ON public.projects FOR SELECT TO authenticated USING (user_id = auth.uid());
CREATE TABLE public.authorized_users (email text PRIMARY KEY, is_active boolean DEFAULT true);
INSERT INTO public.authorized_users VALUES ('alice@example.com', true);
CREATE TABLE public.big (id serial PRIMARY KEY, blob text);
INSERT INTO public.big (blob) SELECT repeat(md5(g::text), 200) FROM generate_series(1, 2000) g;
CREATE TABLE public.schema_migrations (name text PRIMARY KEY, checksum text);
INSERT INTO public.schema_migrations VALUES ('917_cad_uploads.sql', 'x');
SQL

# --- round trip -------------------------------------------------------------------------------------------------------------------
export DOCKER_NETWORK="$ID"
bash scripts/baseline-dump.sh "$(url src)" "$WORK/baseline" | tail -1
check "the dump leaves out the migration record" "" "$(grep -c schema_migrations "$WORK/baseline/counts.txt" | sed 's/^0$//')"
bash scripts/baseline-load.sh "$WORK/baseline" "$(url dst)" | tail -1

check "users keep their ids and (lower-cased) emails" "11111111-1111-4111-8111-111111111111|alice@example.com|Alice A" \
  "$(sql dst -c "select id||'|'||email||'|'||(raw_user_meta_data->>'full_name') from auth.users where id='11111111-1111-4111-8111-111111111111'")"
check "an awkward name (quote and comma) survives" 'Carol, "C"' "$(sql dst -c "select raw_user_meta_data->>'full_name' from auth.users where email='carol@example.com'")"
check "foreign keys to auth.users are intact" "0" "$(sql dst -c "select count(*) from public.projects p left join auth.users u on u.id=p.user_id where u.id is null")"
check "arrays, json, newlines and nulls come back exactly" "$(sql src -c "select md5(string_agg(name||coalesce(tags::text,'~')||coalesce(meta::text,'~'),'|' order by name)) from public.projects")" \
  "$(sql dst -c "select md5(string_agg(name||coalesce(tags::text,'~')||coalesce(meta::text,'~'),'|' order by name)) from public.projects")"
check "large text columns are byte-identical" "$(sql src -c "select md5(string_agg(blob,'' order by id)) from public.big")" "$(sql dst -c "select md5(string_agg(blob,'' order by id)) from public.big")"
check "the migration record was not carried" "0" "$(sql dst -c "select count(*) from information_schema.tables where table_name='schema_migrations'")"
check "row-level security still isolates people after the load (Alice sees 2, Bob sees 1)" "2|1" \
  "$(sql dst -c "begin; set local role authenticated; select set_config('request.jwt.claims','{\"sub\":\"11111111-1111-4111-8111-111111111111\"}',true); select count(*) from public.projects;" | tail -1)|$(sql dst -c "begin; set local role authenticated; select set_config('request.jwt.claims','{\"sub\":\"22222222-2222-4222-8222-222222222222\"}',true); select count(*) from public.projects;" | tail -1)"

check "signed-in users and the service can call the extension functions, as on Supabase (uuid_generate_v4, digest)" "t|t" \
  "$(sql dst -c "begin; set local role authenticated; select uuid_generate_v4() is not null;" | tail -1)|$(sql dst -c "begin; set local role service_role; select length(digest('x','sha256')) = 32;" | tail -1)"

# --- what the cutover depends on: a carried user links by verified email -------------------------------------------------------------
sql dst -c "\i /migrations/931_identity_functions.sql" >/dev/null
check "a carried user is linked by a verified email, to the SAME id" "11111111-1111-4111-8111-111111111111" "$(sql dst -c "select public.link_identity('auth0','auth0|alice','Alice@Example.com',true)")"
check "an unverified email links nobody" "" "$(sql dst -c "select coalesce(public.link_identity('auth0','auth0|evil','bob@example.com',false)::text,'')")"
check "the allow-list came across, so the linked user is authorised" "t" "$(sql dst -c "select public.identity_is_authorized('11111111-1111-4111-8111-111111111111')")"

# --- safety ----------------------------------------------------------------------------------------------------------------------------
if bash scripts/baseline-load.sh "$WORK/baseline" "$(url dst)" >/dev/null 2>"$WORK/again.err"; then echo "FAIL the loader accepted a target that already has data"; fail=1; else echo "ok   the loader refuses a target that already has data"; fi
cp -r "$WORK/baseline" "$WORK/tampered"; echo "tampered" >> "$WORK/tampered/counts.txt"
if bash scripts/baseline-load.sh "$WORK/tampered" "$(url dst2)" >/dev/null 2>&1; then echo "FAIL the loader accepted a baseline that does not match its checksums"; fail=1; else echo "ok   the loader refuses a tampered baseline"; fi
check "a refused load changed nothing" "0" "$(sql dst2 -c "select count(*) from information_schema.tables where table_schema='public'")"
if bash scripts/baseline-dump.sh "$(url src)" "$WORK/baseline" >/dev/null 2>&1; then echo "FAIL the dump overwrote an existing directory"; fail=1; else echo "ok   the dump refuses to overwrite an existing directory"; fi
exit $fail
