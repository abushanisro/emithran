#!/usr/bin/env bash
# Writes docs/API-REFERENCE.md from the reviewed route inventory (the snapshot
# route-policies.spec.ts keeps current). Run after `npx jest route-policies -u`.
set -euo pipefail
root="$(cd "$(dirname "$0")/../.." && pwd)"
snap="$root/backend/src/test/common/authz/__snapshots__/route-policies.spec.ts.snap"
out="$root/docs/API-REFERENCE.md"
{
cat <<'HEAD'
# eMithran API reference

Every route of the public API, grouped by resource. Generated from the reviewed route inventory by `backend/scripts/api-reference.sh`; do not edit by hand. Rules and conventions (envelope, errors, paging, caching, versioning): [API.md](API.md). A live, browsable version with request and response schemas is served by the backend at `/docs` where enabled.

**Base path:** `/api/v1`. **Auth:** `Authorization: Bearer <token>` on everything except `public`. **Errors:** RFC 9457 `application/problem+json`. **Success:** `{ "success": true, "data": …, "metadata": { "timestamp", "requestId" } }`.

**Access levels**

| Level | Who may call |
|---|---|
| `public` | Anyone, no sign-in |
| `authenticated` | Any signed-in user, no organization needed |
| `viewer` | Organization member with at least read access |
| `member` | Organization member who may edit project data |
| `admin` | Organization admin: org settings, rates and master data, forced or bulk deletes |
| `platform-admin` | eMithran staff only |

HEAD
grep -E '^"?(org:|public|authenticated|platform)' "$snap" | sed 's/^"//' | awk '
{
  lvl=$1; sub(/^org:/,"",lvl)
  m=$2; p=$3; h=$4
  sub(/_/,"-",lvl)
  if (p ~ /^\/api\/v1\//) { sub(/^\/api\/v1\//,"",p); full="/api/v1/" p; res=p; sub(/\/.*/,"",res) }
  else { full=p; res="(unversioned: liveness and health)" }
  printf "%s\t%s\t%s\t%s\t%s\n", res, full, m, lvl, h
}' | sort -t$'\t' -k1,1 -k2,2 -k3,3 | awk -F'\t' '
{ if($1!=cur){ if(cur!="") print ""; cur=$1; n++; printf "## %s\n\n| Method | Path | Access | Handler |\n|---|---|---|---|\n", $1 }
  printf "| %s | `%s` | %s | %s |\n", $3, $2, $4, $5; total++ }
END { print "\n---\n\n" total " routes in " n " resources." }'
} > "$out"
echo "wrote $out"
