#!/usr/bin/env bash
# Starts a throwaway Postgres (migration 930 only) and a PostgREST in front of it, then runs smoke.ts against them. Needs Docker.
#   npm run test:postgrest        (from backend/)
set -euo pipefail
cd "$(dirname "$0")"
PG_IMAGE="postgres:17-alpine@sha256:266d3c257594e195b309ae9d1805e54c788f1d7b375f56bf6c367aac6c917e7b"
REST_IMAGE="postgrest/postgrest@sha256:1347d7552b88f17832912c06afbf7c43209af6eeeb60834b04aae12c9bd9d5cc"
ID="pgrst-smoke-$$"
cleanup() { docker rm -f "$ID-pg" "$ID-rest" >/dev/null 2>&1 || true; docker network rm "$ID" >/dev/null 2>&1 || true; }
trap cleanup EXIT

docker network create "$ID" >/dev/null
docker run -d --rm --name "$ID-pg" --network "$ID" -e POSTGRES_PASSWORD=pw -v "$PWD/../../migrations":/migrations:ro "$PG_IMAGE" >/dev/null
for _ in $(seq 1 60); do docker exec "$ID-pg" pg_isready -U postgres >/dev/null 2>&1 && break; sleep 1; done
docker exec -i "$ID-pg" psql -U postgres -v ON_ERROR_STOP=1 -q <<'SQL'
\i /migrations/930_postgres_compat.sql
ALTER ROLE authenticator PASSWORD 'authpw';
INSERT INTO auth.users (id, email) VALUES ('11111111-1111-1111-1111-111111111111','a@example.com'),('22222222-2222-2222-2222-222222222222','b@example.com');
CREATE TABLE public.notes (id serial PRIMARY KEY, owner uuid NOT NULL REFERENCES auth.users(id), body text);
INSERT INTO public.notes (owner, body) VALUES ('11111111-1111-1111-1111-111111111111','mine'),('22222222-2222-2222-2222-222222222222','theirs');
ALTER TABLE public.notes ENABLE ROW LEVEL SECURITY;
CREATE POLICY own_read ON public.notes FOR SELECT TO authenticated USING (owner = auth.uid());
CREATE POLICY own_write ON public.notes FOR INSERT TO authenticated WITH CHECK (owner = auth.uid());
-- What the upload queue (migrations 917, 918, 923) needs, so the Rust runner can be tested against it for real.
CREATE TABLE public.projects (id uuid PRIMARY KEY DEFAULT gen_random_uuid());
CREATE TABLE public.boms (id uuid PRIMARY KEY DEFAULT gen_random_uuid());
CREATE TABLE public.bom_items (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), bom_id uuid, organization_id uuid, file_3d_path text, file_2d_path text, file_dxf_path text);
CREATE FUNCTION public.current_user_org_ids() RETURNS SETOF uuid LANGUAGE sql STABLE AS $$ SELECT NULL::uuid WHERE false $$;
CREATE FUNCTION public.my_email() RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$ SELECT email FROM auth.users WHERE id = auth.uid() $$;
\i /migrations/917_cad_uploads.sql
\i /migrations/918_free_tier_housekeeping.sql
\i /migrations/923_cad_upload_analysed.sql
INSERT INTO public.boms (id) VALUES ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb');
INSERT INTO public.cad_uploads (id, organization_id, created_by, bom_id, file_name, sha256, size_bytes, storage_path, created_at) VALUES
  ('a0000000-0000-4000-8000-000000000001','cccccccc-cccc-4ccc-8ccc-cccccccccccc','11111111-1111-1111-1111-111111111111','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','a.step','s1',1,'p/a.step', now() - interval '3 minutes'),
  ('a0000000-0000-4000-8000-000000000002','cccccccc-cccc-4ccc-8ccc-cccccccccccc','11111111-1111-1111-1111-111111111111','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','b.step','s2',1,'p/b.step', now() - interval '2 minutes'),
  ('a0000000-0000-4000-8000-000000000003','cccccccc-cccc-4ccc-8ccc-cccccccccccc','11111111-1111-1111-1111-111111111111','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','c.step','s3',1,'p/c.step', now() - interval '1 minute');
SQL
JWT_SECRET="$(python3 -c 'import secrets;print(secrets.token_urlsafe(48))')"
docker run -d --rm --name "$ID-rest" --network "$ID" -p 127.0.0.1::3000 --platform linux/amd64 \
  -e PGRST_DB_URI="postgres://authenticator:authpw@$ID-pg:5432/postgres" -e PGRST_DB_SCHEMAS=public -e PGRST_DB_ANON_ROLE=anon \
  -e PGRST_JWT_SECRET="$JWT_SECRET" -e PGRST_SERVER_HOST=0.0.0.0 "$REST_IMAGE" >/dev/null
PORT=""
for _ in $(seq 1 40); do
  PORT="$(docker port "$ID-rest" 3000/tcp 2>/dev/null | head -1 | sed 's/.*://')"
  [ -n "$PORT" ] && curl -fsS -m 2 "http://127.0.0.1:$PORT/" >/dev/null 2>&1 && break
  sleep 1
done
cd ../..
JWT_SECRET="$JWT_SECRET" PGRST_URL="http://127.0.0.1:$PORT" npx ts-node -r reflect-metadata -r tsconfig-paths/register test/postgrest/smoke.ts
# The Rust runner's database half (claim, mark analysed, mark failed, retry) through the same PostgREST, with a token it signs itself.
if command -v cargo >/dev/null 2>&1; then
  (cd ../core && POSTGREST_TEST_URL="http://127.0.0.1:$PORT" DB_JWT_SECRET="$JWT_SECRET" cargo test -p runner --test postgrest_live -- --nocapture)
  ok="$(docker exec "$ID-pg" psql -U postgres -tA -c "SELECT (SELECT status FROM public.cad_uploads WHERE id = 'a0000000-0000-4000-8000-000000000001') = 'analysed' AND (SELECT status || error_code FROM public.cad_uploads WHERE id = 'a0000000-0000-4000-8000-000000000002') = 'failedbad_step' AND (SELECT status FROM public.cad_uploads WHERE id = 'a0000000-0000-4000-8000-000000000003') = 'running'")"
  [ "$ok" = "t" ] || { echo "FAIL the rows are not in the state the runner should have left them"; exit 1; }
  echo "ok   rows are in the state the runner left them (analysed, failed with its code, retried then running)"
else
  echo "skip rust runner database check (no cargo)"
fi
