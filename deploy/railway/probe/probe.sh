#!/bin/sh
# One-off: from INSIDE the environment's private network, resolve and call each service the way its neighbours do. Prints one line per target
# (the HTTP status, and which address families the name resolved to), then PROBE DONE. It sends no credential and reads no data: only each
# service's health or root path.
set -u
check() { # name url
  host="$(printf '%s' "$2" | sed -E 's#^https?://([^:/]+).*#\1#')"
  fam=""
  getent ahostsv4 "$host" >/dev/null 2>&1 && fam="${fam}IPv4 "
  getent ahostsv6 "$host" >/dev/null 2>&1 && fam="${fam}IPv6 "
  code="$(curl -sS -o /dev/null -m 10 -w '%{http_code}' "$2" 2>/tmp/err || true)"
  [ -n "$code" ] && [ "$code" != "000" ] || code="no answer ($(tr '\n' ' ' </tmp/err | cut -c1-80))"
  echo "PROBE $1 -> $code  [name resolves: ${fam:-nothing}]"
}
[ -z "${BACKEND_HOST:-}" ] || check backend "http://$BACKEND_HOST:4000/api/health/live"
[ -z "${POSTGREST_HOST:-}" ] || check postgrest "http://$POSTGREST_HOST:3000/"
[ -z "${CAD_ENGINE_HOST:-}" ] || check cad-engine "http://$CAD_ENGINE_HOST:5055/health"
[ -z "${ECAD_ENGINE_HOST:-}" ] || check ecad-engine "http://$ECAD_ENGINE_HOST:5100/health"
[ -z "${FRONTEND_HOST:-}" ] || check frontend "http://$FRONTEND_HOST:3000/"
echo "PROBE DONE"
