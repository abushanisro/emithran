#!/usr/bin/env bash
# A backup that was never restored is not a backup. Restores one nightly dump (the .tar.age artifact from .github/workflows/ops.yml)
# into a throwaway Postgres container and compares every table's row count with the counts taken at dump time.
#   AGE_IDENTITY=~/backup-age.key backend/scripts/restore-check.sh backup-stage.tar.age
# Needs docker and age. The private key is the operator's; nothing here is sent anywhere. Exits non-zero on any mismatch.
set -euo pipefail

archive="${1:?usage: restore-check.sh <backup.tar.age>}"
identity="${AGE_IDENTITY:?set AGE_IDENTITY to the age private key file}"
IMAGE="postgres:17-alpine@sha256:266d3c257594e195b309ae9d1805e54c788f1d7b375f56bf6c367aac6c917e7b"
work="$(mktemp -d)"
name="restorecheck-$$"
trap 'docker rm -f "$name" >/dev/null 2>&1 || true; rm -rf "$work"' EXIT

age --decrypt --identity "$identity" < "$archive" | tar -C "$work" -xf -
docker run -d --rm --name "$name" -e POSTGRES_PASSWORD=test --tmpfs /var/lib/postgresql/data -v "$work":/backup:ro "$IMAGE" >/dev/null
for _ in $(seq 1 60); do docker exec "$name" pg_isready -h 127.0.0.1 -U postgres >/dev/null 2>&1 && break; sleep 1; done

# Roles that policies and grants mention must exist, or pg_restore reports errors for them.
docker exec "$name" psql -U postgres -q -c "create role anon nologin; create role authenticated nologin; create role service_role nologin; create schema if not exists auth; create schema if not exists storage;" >/dev/null
# pg_restore carries on past individual errors (the public schema already existing, Supabase-only objects); a real data problem
# shows up as a row-count difference below, with the restore's own messages printed next to it.
docker exec "$name" pg_restore -U postgres -d postgres --no-owner /backup/db.dump 2>"$work/restore.err" || true

docker exec "$name" psql -U postgres -At -F" " -c "select table_name, (xpath('/row/c/text()', query_to_xml(format('select count(*) as c from %I.%I', table_schema, table_name), false, true, '')))[1]::text::bigint from information_schema.tables where table_schema = 'public' and table_type = 'BASE TABLE' order by 1" > "$work/restored.txt"

if diff "$work/counts.txt" "$work/restored.txt" >"$work/diff.txt"; then
  echo "restore check passed: $(wc -l < "$work/counts.txt" | tr -d ' ') tables, every row count matches"
else
  echo "restore check FAILED: row counts differ (dump < restored >)"; cat "$work/diff.txt"; echo "--- pg_restore messages"; cat "$work/restore.err"; exit 1
fi
