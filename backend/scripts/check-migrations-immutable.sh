#!/usr/bin/env bash
# A migration that is already on the base branch must not change. A database that applied it has recorded its checksum, and the runner (migrate.ts) refuses to go on
# past a file that differs: nothing newer is applied until someone repairs that database by hand. Migration 956 was edited three times after it was applied, and every
# database that had applied an earlier version stopped taking migrations (so 975 and 976, the plastic cycle-time calculators, never arrived).
#
#   backend/scripts/check-migrations-immutable.sh [base-branch]     default: main
#
# Fails when a pull request modifies, renames or deletes a migration file that the base branch has. A new file (status A) is always fine. A change to a migration is a
# NEW migration (calculators: a new version, see plastic-molding-calculators-migration.ts); docs/DEPLOYMENT_SECURITY.md says how to repair a database.
set -euo pipefail
base="${1:-main}"
root="$(git rev-parse --show-toplevel)"
cd "$root"
git fetch --no-tags --depth=1 origin "$base" >/dev/null 2>&1 || true
ref="origin/$base"
git rev-parse --verify --quiet "$ref" >/dev/null || { echo "check-migrations-immutable: no $ref to compare with; skipped"; exit 0; }

# In a pull request build HEAD is the merge of the branch into the base, so a tree comparison with the base tip is exactly what the pull request changes.
diff="$(git diff --name-status --no-renames "$ref" HEAD -- 'backend/migrations/*.sql')"
changed="$(printf '%s\n' "$diff" | awk '$1 != "A" && NF { print $1 "\t" $2 }')"
if [ -n "$changed" ]; then
  echo "These migrations are on $base and are changed by this branch. A migration that has been applied is never edited (the runner refuses a changed file):"
  printf '%s\n' "$changed" | sed 's/^/  /'
  echo
  echo "Add a new migration with the change instead. For a generated calculator migration, raise the calculator's version in its spec and generate the new migration."
  exit 1
fi
added="$(printf '%s\n' "$diff" | awk '$1 == "A"' | wc -l | tr -d ' ')"
echo "migrations: nothing on $base was changed ($added new)"
