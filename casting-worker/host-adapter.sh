#!/bin/sh
# Between core's cad-worker-host and this worker. The host runs its worker as
#     <worker> --deadline-ms N <out-dir> <input>...
# and this worker (petrus-demo's, copied unchanged) takes
#     geometry-worker --deadline-ms N [--draw-axis x|y|z] <input>... <out-dir>
# so the arguments are reordered here, in the image, rather than in either program. Exit code, output files and signals pass through (exec).
#
# The host passes inputs as plain files and nothing else, so an engineer's draw axis arrives as an input named `draw-axis` whose whole
# content is x, y or z (backend/src/modules/sand-casting/casting-config.ts, DRAW_AXIS_INPUT: keep the names equal). It is turned into
# --draw-axis here and is never handed to the worker as a STEP file. Anything else in it is refused (exit 64), not guessed.
set -eu
[ "${1:-}" = "--deadline-ms" ] && [ "$#" -ge 4 ] || { echo "usage: $0 --deadline-ms N <out-dir> <input>..." >&2; exit 64; }
deadline="$2"
out="$3"
shift 3
axis=""
count=$#
while [ "$count" -gt 0 ]; do   # each input once, in order: the draw-axis input is read, every other one is kept
    input="$1"
    shift
    count=$((count - 1))
    if [ "$(basename "$input")" = "draw-axis" ]; then
        axis="$(cat "$input")"
        case "$axis" in x | y | z) ;; *) echo "draw-axis must be x, y or z" >&2; exit 64 ;; esac
    else
        set -- "$@" "$input"
    fi
done
if [ -n "$axis" ]; then
    exec /usr/local/bin/geometry-worker --deadline-ms "$deadline" --draw-axis "$axis" "$@" "$out"
fi
exec /usr/local/bin/geometry-worker --deadline-ms "$deadline" "$@" "$out"
