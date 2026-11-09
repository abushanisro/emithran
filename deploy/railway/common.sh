#!/usr/bin/env bash
# Shared helpers for the deploy/railway scripts (sourced, not run). Rules every helper keeps:
#  - a secret goes through stdin, never an argument or the screen (`railway add` and `railway variable set` echo what they are given);
#  - railway's output is captured before it is searched (`railway ... | grep -q` kills railway with SIGPIPE and, under pipefail, fails open);
#  - the project's env file (env/stage.env, env/prd.env) is read inside this process and its values are never printed.

# environment name -> its env file
env_file_for() {
  case "$1" in
    staging) echo "$REPO/env/stage.env" ;;
    production) echo "$REPO/env/prd.env" ;;
    *) echo "environment must be staging or production, got: $1" >&2; return 2 ;;
  esac
}

require_cli() {
  command -v railway >/dev/null || { echo "the Railway CLI is not installed (brew install railway)" >&2; exit 2; }
  railway whoami >/dev/null 2>&1 || { echo "not logged in: run railway login" >&2; exit 2; }
}

# env_value <file> <KEY> : the value of KEY in an env file, quotes stripped; empty when unset or still a REPLACE_ME placeholder
env_value() {
  local v
  v="$(sed -n "s/^$2=//p" "$1" | tail -1 | sed -e 's/^"\(.*\)"$/\1/' -e "s/^'\(.*\)'\$/\1/")"
  case "$v" in *REPLACE*) v="" ;; esac
  printf '%s' "$v"
}

# require_env_values <file> <KEY>... : names every missing value, then stops. Values are never shown.
require_env_values() {
  local file="$1"; shift
  local missing=()
  for k in "$@"; do [ -n "$(env_value "$file" "$k")" ] || missing+=("$k"); done
  if [ "${#missing[@]}" -gt 0 ]; then echo "missing in $(basename "$file"): ${missing[*]}" >&2; return 1; fi
}

# set_secret <service> <environment> <KEY> : reads the value from stdin
set_secret() {
  railway variable set "$3" --stdin --service "$1" --environment "$2" >/dev/null
}

# set_secret_from_env_file <service> <environment> <file> <KEY>
set_secret_from_env_file() {
  env_value "$3" "$4" | set_secret "$1" "$2" "$4"
}

# service_exists <environment> <service>. Text is searched with a here-string, not a pipe: a reader that stops early (grep -q, awk exit) breaks
# the pipe, the writer dies with SIGPIPE, and under pipefail the whole command then fails, silently under set -e.
service_exists() {
  local listing
  listing="$(railway service list --environment "$1" 2>&1 || true)"
  grep -qE "^$2( |\$)" <<<"$listing"
}

# project_id_of : the id of the linked Railway project
project_id_of() {
  local status
  status="$(railway status 2>&1 || true)"
  awk '/Project ID:/{print $3; exit}' <<<"$status"
}

# wait_for_log <service> <environment> <fixed string> <seconds> : true once the string appears in the service's log
wait_for_log() {
  local logs waited=0
  while [ "$waited" -lt "$4" ]; do
    logs="$(railway service logs --service "$1" --environment "$2" 2>&1 || true)"
    if grep -qF -- "$3" <<<"$logs"; then return 0; fi
    sleep 10; waited=$((waited + 10))
  done
  return 1
}

# on_error : an ERR trap that says where a script stopped (never what it was holding), so a failure is not silent
on_error() { echo "error: $(basename "$0") stopped at line $1" >&2; }

# add_service_quietly <railway add arguments...> : `railway add` echoes every variable it is given, so its output is shown only on failure
add_service_quietly() {
  local out
  if ! out="$(railway add "$@" 2>&1)"; then printf '%s\n' "$out" >&2; return 1; fi
}
