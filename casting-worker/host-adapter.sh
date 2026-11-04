#!/bin/sh
# Between core's cad-worker-host and this worker. The host runs its worker as
#     <worker> --deadline-ms N <out-dir> <input>...
# and this worker (petrus-demo's, copied unchanged) takes
#     geometry-worker --deadline-ms N <input>... <out-dir>
# so the arguments are reordered here, in the image, rather than in either program. Exit code, output files and signals pass through (exec).
set -eu
[ "${1:-}" = "--deadline-ms" ] && [ "$#" -ge 4 ] || { echo "usage: $0 --deadline-ms N <out-dir> <input>..." >&2; exit 64; }
deadline="$2"
out="$3"
shift 3
exec /usr/local/bin/geometry-worker --deadline-ms "$deadline" "$@" "$out"
