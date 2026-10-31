#!/usr/bin/env bash
# Fails if a delivered image carries our source maps or TypeScript (declarations or sources) in its application folder.
# Third-party files under node_modules are not ours and are not checked.
#   scripts/check-image-no-sourcemaps.sh <image> [app-dir]      (app-dir defaults to app/dist)
set -euo pipefail
image="${1:?usage: $0 <image> [app-dir]}"
app_dir="${2:-app/dist}"
engine="${CONTAINER:-docker}"

id=$("$engine" create "$image")
trap '"$engine" rm -f "$id" >/dev/null' EXIT

found=$("$engine" export "$id" | tar -t | grep -E "^${app_dir}/.*\.(map|ts)$" || true)
if [ -n "$found" ]; then
  echo "FAIL: $image ships source maps or TypeScript under /$app_dir:"
  echo "$found" | head -20
  echo "($(echo "$found" | wc -l | tr -d ' ') files)"
  exit 1
fi
echo "OK: no source maps or TypeScript under /$app_dir in $image"
