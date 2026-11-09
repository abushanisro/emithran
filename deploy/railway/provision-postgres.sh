#!/usr/bin/env bash
# Creates the Postgres of one Railway environment: Postgres 17, the major version the repo is built and tested on (CI's SQL tests and
# the nightly backup's pg_dump client are 17; a pg_dump 17 refuses to dump a newer server), one volume, and a generated password.
#
#   deploy/railway/provision-postgres.sh <staging|production>
#
# The database gets NO public address: other services reach it on Railway's private network through the reference variable
# ${{postgres.DATABASE_URL}}. It refuses to run when the environment already has a service called postgres, so it never replaces data.
# Needs: the Railway CLI, logged in (`railway login`), and the project linked or RAILWAY_PROJECT_ID set. See deploy/railway/README.md.
set -Eeuo pipefail

environment="${1:?usage: provision-postgres.sh <staging|production>}"
case "$environment" in staging|production) ;; *) echo "environment must be staging or production, got: $environment" >&2; exit 2 ;; esac

# The Railway template's image (it serves TLS and refuses to start without its volume), pinned by digest like the other images.
PG_IMAGE="ghcr.io/railwayapp-templates/postgres-ssl:17@sha256:5e806d28c18198f933d25e79989470a47a938f465bf0634e030b416961b3463e"
DATA_PATH="/var/lib/postgresql/data"

command -v railway >/dev/null || { echo "the Railway CLI is not installed (brew install railway)" >&2; exit 2; }
command -v openssl >/dev/null || { echo "openssl is needed to generate the password" >&2; exit 2; }
railway whoami >/dev/null 2>&1 || { echo "not logged in: run railway login" >&2; exit 2; }

railway environment "$environment" >/dev/null
# The listing is captured first and searched with a here-string: `railway ... | grep -q` closes the pipe early, kills railway with SIGPIPE,
# and under pipefail made this guard read "no postgres here" and carry on.
services="$(railway service list --environment "$environment" 2>&1 || true)"
if grep -qE '^postgres( |$)' <<<"$services"; then
  echo "refusing: $environment already has a postgres service. This script only creates one." >&2
  exit 1
fi

echo "creating postgres in $environment..."
# The password never goes through an argument list or the screen: the service is created without it (the image cannot start yet anyway,
# it has no volume), then the value is read from stdin. `railway add` echoes every variable it is given, so its output is not shown.
# shellcheck disable=SC2016  # ${{...}} is Railway's reference syntax, resolved by Railway: it must reach the CLI unexpanded
if ! out="$(railway add --image "$PG_IMAGE" --service postgres \
  --variables "POSTGRES_USER=postgres" \
  --variables "POSTGRES_DB=emithran" \
  --variables "PGDATA=$DATA_PATH/pgdata" \
  --variables 'DATABASE_URL=postgresql://postgres:${{POSTGRES_PASSWORD}}@${{RAILWAY_PRIVATE_DOMAIN}}:5432/emithran' 2>&1)"; then
  printf '%s\n' "$out" >&2
  case "$out" in
    *"already exists in this project"*) echo "Railway service names are unique per project, so a second environment's database is created by duplicating a finished environment (see deploy/railway/README.md), not by this script." >&2 ;;
  esac
  exit 1
fi
openssl rand -hex 24 | railway variable set POSTGRES_PASSWORD --stdin --service postgres --environment "$environment" >/dev/null

railway service link postgres >/dev/null
railway volume add --mount-path "$DATA_PATH" >/dev/null
# The image stops at start-up when the volume is missing, so redeploy now that it is attached.
railway service redeploy --service postgres --yes >/dev/null

echo "waiting for postgres to accept connections..."
for _ in $(seq 1 30); do
  sleep 10
  logs="$(railway service logs --service postgres --environment "$environment" 2>&1 || true)" # captured first: see the guard above
  if grep -q "database system is ready to accept connections" <<<"$logs"; then
    echo "postgres is ready in $environment (private address only; no public proxy)."
    echo "next: deploy/railway/seed-environment.sh $environment <baseline-dir>"
    exit 0
  fi
done
echo "postgres did not report ready within 5 minutes; check: railway service logs --service postgres --environment $environment" >&2
exit 1
