#!/usr/bin/env bash
# Turns on "Sign in with SSO" through Google for company domains only (docs/ops/sso.md). Runs with the logged-in Auth0 CLI (`auth0 login`).
#
#   infra/auth0/setup-company-google-sso.sh            asks for the Google client id and secret (hidden), then applies
#   DRY_RUN=1 infra/auth0/setup-company-google-sso.sh  shows what it would change, changes nothing
#   ALLOWED_GOOGLE_DOMAINS=emithran.com,emuski.com,newco.com ...   the company domains (default below)
#
# Order matters: the domain rule (Action) is deployed and attached BEFORE the Google connection is switched on for the apps, so there is
# never a moment where any Google account could sign in. Running it again is safe: it updates instead of duplicating.
set -Eeuo pipefail
trap 'echo "setup-company-google-sso.sh failed at line $LINENO" >&2' ERR
cd "$(git rev-parse --show-toplevel)"
domains="${ALLOWED_GOOGLE_DOMAINS:-emithran.com,emuski.com}"
apps="KVp4wXDVKV4fNARjMkDfehdfx7xCPoiR yfh7DddWUI3e9KIhmcpEhRCBMz3ARONs"   # EMITHRAN Cloud (production), EMITHRAN Cloud (Stage) (staging + local)
action=company-google-login
src=infra/auth0/company-google-login.ts
tmp="$(mktemp -d)"; chmod 700 "$tmp"; trap 'rm -rf "$tmp"' EXIT
a0() { auth0 api "$@" --no-input; }
field() { python3 -c "import json,sys;d=json.load(sys.stdin);print($1)"; }

conn="$(a0 get "connections?strategy=google-oauth2&fields=id" | field 'd[0]["id"]')"
existing="$(a0 get "actions/actions?actionName=$action" | field '(d["actions"] or [{}])[0].get("id","")')"
echo "domains : $domains"
echo "action  : $action (${existing:-new}) compiled from $src, then attached first in the post-login flow (existing Actions kept)"
echo "google  : connection $conn gets your own Google client (not Auth0's test keys), then is switched on for: $apps"
if [ "${DRY_RUN:-0}" = 1 ]; then echo "DRY_RUN: nothing changed."; exit 0; fi

read -r -p "Google OAuth client ID: " gid
read -r -s -p "Google OAuth client secret (hidden): " gsecret; echo
[ -n "$gid" ] && [ -n "$gsecret" ] || { echo "client id and secret are required" >&2; exit 2; }

echo "[1/4] Action: compile (Auth0 runs JavaScript), create or update, then deploy"
npx tsc --module commonjs --target es2022 --skipLibCheck --outDir "$tmp" "$src"
python3 - "$tmp/company-google-login.js" "$domains" > "$tmp/action.json" <<'PY'
import json,sys
print(json.dumps({"name":"company-google-login","supported_triggers":[{"id":"post-login","version":"v3"}],"runtime":"node22",
  "code":open(sys.argv[1]).read(),"secrets":[{"name":"ALLOWED_GOOGLE_DOMAINS","value":sys.argv[2]}]}))
PY
if [ -n "$existing" ]; then
  python3 -c "import json;d=json.load(open('$tmp/action.json'));d.pop('name');d.pop('supported_triggers');print(json.dumps(d))" > "$tmp/patch.json"
  id="$existing"; a0 patch "actions/actions/$id" --data "@$tmp/patch.json" >/dev/null
else
  id="$(a0 post actions/actions --data "@$tmp/action.json" | field 'd["id"]')"
fi
for _ in $(seq 1 30); do [ "$(a0 get "actions/actions/$id" | field 'd["status"]')" = built ] && break; sleep 2; done
a0 post "actions/actions/$id/deploy" >/dev/null

echo "[2/4] Action: attached first in the post-login flow"
a0 get actions/triggers/post-login/bindings | python3 -c "
import json,sys
others=[{'ref':{'type':'action_id','value':b['action']['id']},'display_name':b['display_name']} for b in json.load(sys.stdin)['bindings'] if b['action']['id']!='$id']
print(json.dumps({'bindings':[{'ref':{'type':'action_id','value':'$id'},'display_name':'$action'}]+others}))" > "$tmp/bindings.json"
a0 patch actions/triggers/post-login/bindings --data "@$tmp/bindings.json" >/dev/null

echo "[3/4] Google connection: your own client, account chooser always shown (kept options otherwise)"
a0 get "connections/$conn" | GID="$gid" GSECRET="$gsecret" python3 -c "
import json,os,sys
o=json.load(sys.stdin)['options']; o.update(client_id=os.environ['GID'], client_secret=os.environ['GSECRET'], email=True, profile=True)
# Always show the Google account chooser: someone signed in to Google as one person can pick another, and logging out then in is never a silent re-login
o['upstream_params']={'prompt':{'value':'select_account'}}
print(json.dumps({'options':o}))" > "$tmp/conn.json"
[ -s "$tmp/conn.json" ] || { echo "internal error: empty connection update, nothing sent" >&2; exit 1; }
a0 patch "connections/$conn" --data "@$tmp/conn.json" >/dev/null

echo "[4/4] Google connection: switched on for the apps"
python3 -c "import json;print(json.dumps([{'client_id':c,'status':True} for c in '$apps'.split()]))" > "$tmp/clients.json"
a0 patch "connections/$conn/clients" --data "@$tmp/clients.json" >/dev/null
echo "done. Now set NEXT_PUBLIC_AUTH0_SSO_CONNECTION=google-oauth2 and add google-oauth2 to AUTH0_TRUSTED_CONNECTIONS (docs/ops/sso.md)."
