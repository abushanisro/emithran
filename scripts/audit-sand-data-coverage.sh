#!/usr/bin/env bash
# Lists which sand-casting reference variables, lookup tables and machine files
# the backend never reads. Prints names only (never values), so the output may
# be pasted into docs without copying the private reference data (D13).
# Test and spec files do not count as reading.
# Usage: scripts/audit-sand-data-coverage.sh [reference-dir]
set -euo pipefail
root="$(cd "$(dirname "$0")/.." && pwd)"
ref="${1:-$root/memory/Sand casting}"
src="$root/backend/src"
used() { grep -rqwF --exclude='*.spec.ts' --exclude-dir=test -- "$1" "$src"; }

echo "## Variables not read by code"
tail -n +2 "$ref/sand_casting_variables.csv" | sed 's/^\xEF\xBB\xBF//' | cut -d, -f1 | sort -u |
  while read -r n; do
    if [ -n "$n" ] && ! used "$n"; then echo "- $n"; fi
  done

echo
echo "## Lookup tables not read by code"
for f in "$ref"/Lookup/lookupTables_Component_*.csv; do
  t="$(basename "$f" .csv)"
  t="${t#lookupTables_Component_}"
  if ! used "$t"; then echo "- $t"; fi
done

echo
echo "## Machine files not read by code (class = file suffix)"
for f in "$ref"/Machine/machines_*.csv; do
  c="$(basename "$f" .csv)"
  c="${c#machines_}"
  if ! used "$c"; then echo "- $c"; fi
done
