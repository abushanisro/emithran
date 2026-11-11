#!/usr/bin/env bash
# Invites people to production: adds each email to the user directory and to the authorized list. Emithran is invite-only: a login is accepted only when
# its verified email matches a directory row that has no login yet AND is on the authorized list (backend/src/modules/auth/identity.service.ts, link_identity).
# The first customer administrator cannot be invited by anyone, so this is how the first account exists. After their first sign-in they create their own
# organization in the app (the normal flow: organization, owner membership, default workspace) and invite colleagues from there.
#
#   infra/oracle/authorize-user.sh <email> [<email> ...]
#   [PG_CONTAINER=<name>] [ENV_FILE=env/prd.env]        (default: the postgres container of the compose project emithran-prd)
#
# Idempotent and additive: it never deletes or changes an existing person.
set -Eeuo pipefail
trap 'echo "authorize-user.sh failed at line $LINENO" >&2' ERR
[ "$#" -ge 1 ] || { echo "usage: authorize-user.sh <email> [<email> ...]" >&2; exit 2; }
emails=""
for e in "$@"; do
  e="$(printf '%s' "$e" | tr '[:upper:]' '[:lower:]' | tr -d '[:space:]')"
  case "$e" in *[!a-z0-9@._+-]*|@*|*@|*@*@*|*@*.) echo "not a usable email address: $e" >&2; exit 2 ;; esac
  case "$e" in *@*.*) ;; *) echo "not a usable email address: $e" >&2; exit 2 ;; esac
  emails="${emails:+$emails,}$e"
done
env_file="${ENV_FILE:-env/prd.env}"
pg="${PG_CONTAINER:-$(docker compose -p emithran-prd -f docker-compose.prod.yml -f docker-compose.data.yml --env-file "$env_file" ps -q postgres)}"
[ -n "$pg" ] || { echo "no postgres container (is the data tier running?)" >&2; exit 2; }
docker exec -i "$pg" psql -U postgres -d postgres -v ON_ERROR_STOP=1 -v emails="$emails" -At <<'SQL'
begin;
select set_config('invite.emails', :'emails', true);
do $$
declare e text; added_dir int := 0; added_auth int := 0;
begin
  foreach e in array string_to_array(current_setting('invite.emails'), ',') loop
    if not exists (select 1 from auth.users where lower(email) = e) then
      insert into auth.users (id, email) values (gen_random_uuid(), e); added_dir := added_dir + 1;
    end if;
    if not exists (select 1 from public.authorized_users where lower(email) = e) then
      insert into public.authorized_users (email) values (e); added_auth := added_auth + 1;
    end if;
  end loop;
  raise notice 'invited: % new directory entries, % new authorizations (already-present people are left as they are)', added_dir, added_auth;
end $$;
commit;
SQL
