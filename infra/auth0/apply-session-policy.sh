#!/usr/bin/env bash
# Applies Emithran's sign-in session policy in Auth0 (docs/ops/sso.md, decision 2026-11-12). Runs with the logged-in Auth0 CLI (`auth0 login`).
#
#   infra/auth0/apply-session-policy.sh             applies it (safe to rerun: it sets values, it never adds anything)
#   DRY_RUN=1 infra/auth0/apply-session-policy.sh   prints what it would set, changes nothing
#
# - Refresh tokens rotate (a reused one revokes the whole family, so a stolen copy is caught) and end 8 hours after sign-in, the same
#   limit as the app's session cookie (lib/auth0.ts). The 60-second leeway lets the app's parallel API calls refresh together
#   without that being mistaken for reuse.
# - Access tokens for the API last 1 hour instead of 24 (the app renews them by itself).
# - The sign-in apps use the authorization code flow only: the unused implicit grant is switched off.
set -Eeuo pipefail
trap 'echo "apply-session-policy.sh failed at line $LINENO" >&2' ERR
apps="KVp4wXDVKV4fNARjMkDfehdfx7xCPoiR yfh7DddWUI3e9KIhmcpEhRCBMz3ARONs"   # EMITHRAN Cloud (production), EMITHRAN Cloud (Stage) (staging + local)
apis="https://api.platform.emithran.com https://api.emithran.com"         # AUTH0_AUDIENCE of production, and of staging + local
app_policy='{"refresh_token":{"rotation_type":"rotating","expiration_type":"expiring","token_lifetime":28800,"infinite_token_lifetime":false,"infinite_idle_token_lifetime":true,"leeway":60},"grant_types":["authorization_code","refresh_token"]}'
api_policy='{"token_lifetime":3600}'

for id in $apps; do echo "app $id: $app_policy"; done
for api in $apis; do echo "api $api: $api_policy"; done
if [ "${DRY_RUN:-0}" = 1 ]; then echo "DRY_RUN: nothing changed."; exit 0; fi

for id in $apps; do auth0 api patch "clients/$id" --data "$app_policy" --no-input >/dev/null; done
for api in $apis; do
  auth0 api patch "resource-servers/$(python3 -c 'import sys,urllib.parse;print(urllib.parse.quote(sys.argv[1],safe=""))' "$api")" --data "$api_policy" --no-input >/dev/null
done
echo "done. People signed in before this keep their current tokens until they next sign in."
