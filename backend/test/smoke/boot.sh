#!/usr/bin/env bash
# Boots the BUILT backend with no Supabase at all (Auth0 + PostgREST + S3 settings) and checks it serves health and rejects bad logins.
# Runs from a throwaway copy of dist/ so the repo's root .env (which wins over the environment) cannot leak in.
#   npm run build && npm run test:boot        (from backend/)
set -euo pipefail
HERE="$(cd "$(dirname "$0")/../.." && pwd)"
[ -f "$HERE/dist/main.js" ] || { echo "run the build first: npm run build"; exit 1; }
TMP="$(mktemp -d)"; mkdir -p "$TMP/backend"
cp -r "$HERE/dist" "$TMP/backend/dist"; cp "$HERE/package.json" "$TMP/backend/"; ln -s "$HERE/node_modules" "$TMP/backend/node_modules"
PORT=4519
cleanup() { if [ -n "${PID:-}" ]; then kill "$PID" 2>/dev/null || true; wait "$PID" 2>/dev/null || true; fi; rm -rf "$TMP"; }
trap cleanup EXIT
cd "$TMP/backend"
env -i PATH="$PATH" HOME="$HOME" NODE_ENV=development APP_ENV=local BACKEND_PORT=$PORT CAD_UPLOAD_RUNNER=off \
  DB_BACKEND=postgrest POSTGREST_URL=http://127.0.0.1:1 DB_JWT_SECRET="$(python3 -c 'import secrets;print(secrets.token_urlsafe(48))')" \
  AUTH_BACKEND=auth0 AUTH0_DOMAIN=t.eu.auth0.com AUTH0_AUDIENCE=https://api.example.com AUTH0_CLAIM_NAMESPACE=https://emithran.com/ \
  STORAGE_BACKEND=s3 S3_BUCKET=b S3_REGION=us-east-1 S3_ACCESS_KEY_ID=a S3_SECRET_ACCESS_KEY=b \
  node dist/main > "$TMP/boot.log" 2>&1 &
PID=$!
for _ in $(seq 1 90); do curl -s -o /dev/null "http://127.0.0.1:$PORT/api/health/live" && break; kill -0 "$PID" 2>/dev/null || { tail -20 "$TMP/boot.log"; echo "FAIL backend exited"; exit 1; }; sleep 1; done
fail=0
expect() { # name, expected-status, actual-status
  if [ "$2" = "$3" ]; then echo "ok   $1"; else echo "FAIL $1 (wanted $2, got $3)"; fail=1; fi
}
expect "health is up" 200 "$(curl -s -o /dev/null -w '%{http_code}' "http://127.0.0.1:$PORT/api/health/live")"
expect "/auth/me without a token is 401" 401 "$(curl -s -o /dev/null -w '%{http_code}' "http://127.0.0.1:$PORT/v1/api/auth/me")"
expect "/auth/me with a forged token is 401" 401 "$(curl -s -o /dev/null -w '%{http_code}' -H 'Authorization: Bearer a.b.c' "http://127.0.0.1:$PORT/v1/api/auth/me")"
expect "a data route without a token is 401" 401 "$(curl -s -o /dev/null -w '%{http_code}' "http://127.0.0.1:$PORT/v1/api/profile")"
exit $fail
