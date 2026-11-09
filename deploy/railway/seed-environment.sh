#!/usr/bin/env bash
# Gives a Railway environment's EMPTY Postgres its schema, reference data and migrations, from inside Railway's private network, so the
# database never needs a public address.
#
#   deploy/railway/seed-environment.sh <staging|production> <baseline-dir>     bootstrap, then migrate
#   deploy/railway/seed-environment.sh <staging|production> --migrate-only     only the migrations after the baseline (every later release)
#   CONFIRM_PRODUCTION=yes ...                                                  required for production
#   DROP_DANGLING=0 ...                                                         stop on rows with no parent instead of setting them aside
#
# 1. bootstrap  runs backend/scripts/baseline-load.sh unmodified in a job: roles, extensions, user directory, public schema, foreign keys,
#               then every table's row count against the baseline's counts.txt. It refuses a database that already has tables.
# 2. migrate    runs backend/scripts/migrate.ts: every migration after migrations/BASELINE.json, each in its own transaction.
# Each job is a temporary Railway service, deleted afterwards (also when it fails), and the temporary folder that holds a copy of the
# baseline (reference data and the user directory) is removed. Success is read from the job's log, not assumed from its exit.
# Needs: the Railway CLI logged in, the project linked (or RAILWAY_PROJECT_ID), Docker is NOT needed. See deploy/railway/README.md.
set -Eeuo pipefail

here="$(cd "$(dirname "$0")" && pwd)"
repo="$(cd "$here/../.." && pwd)"
REPO="$repo"
# shellcheck source=common.sh
. "$here/common.sh"
trap 'on_error $LINENO' ERR
environment="${1:?usage: seed-environment.sh <staging|production> <baseline-dir | --migrate-only>}"
baseline_arg="${2:?usage: seed-environment.sh <staging|production> <baseline-dir | --migrate-only>}"
drop_dangling="${DROP_DANGLING:-1}"

case "$environment" in
  staging) runner_env=stage; runner_flags="" ;;
  production)
    runner_env=prd; runner_flags="--confirm"
    [ "${CONFIRM_PRODUCTION:-}" = "yes" ] || { echo "production changes a live database: run again with CONFIRM_PRODUCTION=yes" >&2; exit 2; }
    ;;
  *) echo "environment must be staging or production, got: $environment" >&2; exit 2 ;;
esac
migrate_only=0; [ "$baseline_arg" = "--migrate-only" ] && migrate_only=1

command -v railway >/dev/null || { echo "the Railway CLI is not installed (brew install railway)" >&2; exit 2; }
railway whoami >/dev/null 2>&1 || { echo "not logged in: run railway login" >&2; exit 2; }
sha256_check() { if command -v shasum >/dev/null; then shasum -a 256 -c "$1"; else sha256sum -c "$1"; fi; }

if [ "$migrate_only" = 0 ]; then
  baseline="$(cd "$baseline_arg" && pwd)"
  for f in db.dump auth_users.csv counts.txt SHA256SUMS; do [ -s "$baseline/$f" ] || { echo "the baseline is missing or has an empty $f: $baseline" >&2; exit 2; }; done
  (cd "$baseline" && sha256_check SHA256SUMS >/dev/null) || { echo "the baseline files do not match SHA256SUMS" >&2; exit 2; }
fi

railway environment "$environment" >/dev/null
service_exists "$environment" postgres \
  || { echo "$environment has no postgres service: run deploy/railway/provision-postgres.sh $environment first" >&2; exit 2; }
project_id="${RAILWAY_PROJECT_ID:-$(project_id_of)}"
[ -n "$project_id" ] || { echo "cannot tell which Railway project this is: link it (railway link) or set RAILWAY_PROJECT_ID" >&2; exit 2; }

work="$(mktemp -d)"
created=()
cleanup() {
  status=$?
  for name in ${created[@]+"${created[@]}"}; do
    railway service delete --service "$name" --environment "$environment" --yes >/dev/null 2>&1 || echo "WARNING: could not delete the temporary service $name: delete it in the Railway dashboard" >&2
  done
  rm -rf "$work"
  exit $status
}
trap cleanup EXIT

# run_job <name> <context-dir> <variable>...  : creates the service, deploys the context, waits for the job to finish, leaves its log in $work/<name>.log
run_job() {
  local name="$1" context="$2"; shift 2
  local vars=(); for v in "$@"; do vars+=(--variables "$v"); done
  # `railway add` echoes every variable it is given; its output is shown only when it fails.
  if ! out="$(railway add --service "$name" "${vars[@]}" 2>&1)"; then printf '%s\n' "$out" >&2; return 1; fi
  created+=("$name")
  echo "[$name] building and starting in $environment..."
  (cd "$context" && railway up --service "$name" --environment "$environment" --project "$project_id" --ci >"$work/$name.build.log" 2>&1) \
    || { tail -20 "$work/$name.build.log" >&2; echo "[$name] the build failed" >&2; return 1; }
  local state=""
  for _ in $(seq 1 120); do
    status_text="$(railway service status --service "$name" --environment "$environment" 2>&1 || true)"
    state="$(awk '/Status:/{print $2; exit}' <<<"$status_text")"
    case "$state" in STOPPED|FAILED|CRASHED|REMOVED) break ;; esac
    sleep 10
  done
  sleep 5 # the last log lines arrive a moment after the container stops
  railway service logs --service "$name" --environment "$environment" >"$work/$name.log" 2>&1 || true
  echo "[$name] finished: $state"
  case "$state" in STOPPED|FAILED|CRASHED) ;; *) echo "[$name] did not finish within 20 minutes" >&2; return 1 ;; esac
}

if [ "$migrate_only" = 0 ]; then
  ctx="$work/bootstrap"; mkdir -p "$ctx/app/scripts" "$ctx/app/migrations"
  cp -R "$here/bootstrap/." "$ctx/"
  cp "$repo/backend/scripts/baseline-load.sh" "$ctx/app/scripts/"
  cp "$repo/backend/migrations/930_postgres_compat.sql" "$ctx/app/migrations/"
  cp -R "$baseline" "$ctx/baseline"
  # shellcheck disable=SC2016  # ${{...}} is Railway's reference syntax, resolved by Railway: it must reach the CLI unexpanded
  run_job bootstrap "$ctx" 'TARGET_URL=${{postgres.DATABASE_URL}}' "DROP_DANGLING=$drop_dangling" || true
  grep -E "rows with no parent|row\(s\)|set aside|refusing|baseline loaded" "$work/bootstrap.log" | cut -c1-200 || true
  grep -q "baseline loaded:" "$work/bootstrap.log" || { echo "bootstrap did not finish with 'baseline loaded:'; the full log follows" >&2; cat "$work/bootstrap.log" >&2; exit 1; }
fi

ctx="$work/migrate"; mkdir -p "$ctx"
for f in package.json package-lock.json .npmrc; do cp "$repo/backend/$f" "$ctx/"; done
cp "$repo"/backend/tsconfig*.json "$ctx/"
cp -R "$repo/backend/src" "$repo/backend/scripts" "$repo/backend/migrations" "$ctx/"
rm -rf "$ctx/src/test" "$ctx/migrations/baseline"
cp "$here/migrate/Dockerfile" "$here/migrate/railway.json" "$ctx/"
# shellcheck disable=SC2016  # ${{...}} is Railway's reference syntax, resolved by Railway: it must reach the CLI unexpanded
run_job migrate "$ctx" "MIGRATE_ENV=$runner_env" "APP_ENV=$runner_env" 'MIGRATE_DATABASE_URL=${{postgres.DATABASE_URL}}' "MIGRATE_FLAGS=$runner_flags" || true

# The runner prints "<env>: <n> applied, <p> pending" first, then one "applied <file>" line per migration; any failure is an "x" line.
pending="$(sed -n 's/^.*: [0-9][0-9]* applied, \([0-9][0-9]*\) pending.*/\1/p' "$work/migrate.log" | head -1)"
applied="$(grep -c '^ *applied ' "$work/migrate.log" || true)"
if grep -qE '^ +x ' "$work/migrate.log" || [ -z "$pending" ] || [ "$pending" != "$applied" ]; then
  echo "the migrations did not all apply (pending $pending, applied $applied); the log follows" >&2
  cat "$work/migrate.log" >&2
  exit 1
fi
echo "done: $environment is seeded and migrated ($applied migration(s) applied)."
