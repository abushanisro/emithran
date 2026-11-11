#!/usr/bin/env bash
# A 30-second end-to-end check that a deployment really works, from the outside, the way a visitor reaches it. Read-only: it changes nothing.
#
#   scripts/smoke.sh https://stage.emithran.com                 public checks (no account needed)
#   SMOKE_COOKIE_FILE=<file> scripts/smoke.sh <url>            also a signed-in check (the cookie file comes from scripts/loadtest/session.mjs)
#
# Each line prints PASS or FAIL with the reason; the exit code is the number of failures (0 = healthy).
# What each check proves for the app:
#  ready        the backend, the database and both CAD engines answer (not just "the process is up")
#  login        the sign-in hand-off works and points back at THIS site (a wrong callback is the usual stage break)
#  home         the frontend renders
#  CSP          the security policy is present, uses a per-request nonce and names no retired host
#  auth wall    the data API refuses a visitor who is not signed in
#  signed in    (optional) a real session reaches the projects list through frontend -> backend -> data API -> database
set -uo pipefail
base="${1:?usage: smoke.sh <https://site>}"; base="${base%/}"
fail=0
pass() { echo "PASS  $1"; }
bad()  { echo "FAIL  $1" >&2; fail=$((fail+1)); }
get()  { curl -sS --max-time 20 "$@" 2>/dev/null; }

body="$(get "$base/api/health/ready" -w ' %{http_code}')"
case "$body" in *'"status":"ok"'*' 200') pass "ready: backend, database and engines answer" ;; *) bad "ready: expected {\"status\":\"ok\"} 200, got: ${body:0:80}" ;; esac

hdr="$(get -D - -o /dev/null "$base/auth/login")"
code="$(printf '%s' "$hdr" | head -1 | tr -d '\r' | awk '{print $2}')"; loc="$(printf '%s' "$hdr" | tr -d '\r' | sed -n 's/^[Ll]ocation: //p')"
want="$(python3 -c 'import sys,urllib.parse as u;print(u.quote(sys.argv[1]+"/auth/callback",safe=""))' "$base")"
if [ "$code" = 307 ] && printf '%s' "$loc" | grep -q "redirect_uri=$want"; then pass "login: redirects to sign-in and back to $base/auth/callback"
else bad "login: expected 307 with redirect_uri $base/auth/callback, got $code ${loc:0:120}"; fi

home="$(get -D - -o /dev/null "$base/")"; hc="$(printf '%s' "$home" | head -1 | tr -d '\r' | awk '{print $2}')"
case "$hc" in 200|307) pass "home: answers $hc" ;; *) bad "home: expected 200 or 307, got ${hc:-no answer}" ;; esac

csp="$(printf '%s' "$home" | tr -d '\r' | grep -i '^content-security-policy:' | head -1)"
if [ -n "$csp" ] && printf '%s' "$csp" | grep -q "'nonce-" && ! printf '%s' "$csp" | grep -qi 'railway'; then pass "CSP: present, per-request nonce, no retired hosts"
else bad "CSP: missing, no nonce, or names a retired host"; fi

ac="$(get -o /dev/null -w '%{http_code}' "$base/api/v1/projects")"
case "$ac" in 401|403|307) pass "auth wall: data API refuses a visitor ($ac)" ;; *) bad "auth wall: /api/v1/projects answered $ac to a visitor (expected 401/403/307)" ;; esac

if [ -n "${SMOKE_COOKIE_FILE:-}" ]; then
  out="$(get -H "Cookie: $(cat "$SMOKE_COOKIE_FILE")" -w ' %{http_code}' "$base/api/v1/projects")"
  case "$out" in *' 200') pass "signed in: the projects list loads through the whole stack" ;; *) bad "signed in: /api/v1/projects answered ${out##* } (session expired? re-run session.mjs)" ;; esac
fi
[ "$fail" = 0 ] && echo "SMOKE OK: $base" || echo "SMOKE FAILED ($fail): $base" >&2
exit "$fail"
