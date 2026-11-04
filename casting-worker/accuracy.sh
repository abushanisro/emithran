#!/usr/bin/env bash
# The accuracy gate of the sand casting analysis (design step S3): runs the casting worker, in its sandbox, on every part of a manifest and compares its
# measurements with the engineer's labels (backend/src/test-tools/casting-accuracy.ts). Never copies a part anywhere: the corpus is mounted read-only
# and the results go to a temporary folder that is removed at the end. Real parts are customer data and are never committed or put in an image.
#   casting-worker/accuracy.sh --synthetic            the hand-worked synthetic samples (a check of the tooling; it can never pass S3)
#   casting-worker/accuracy.sh <manifest.json>        a corpus: the manifest's `file` paths are relative to the manifest's folder
# Exit codes are the gate's: 0 measurements within tolerance, 1 not, 2 invalid manifest. CONTAINER=podman for Podman.
set -euo pipefail
cd "$(dirname "$0")/.."
CONTAINER="${CONTAINER:-docker}"
IMAGE="casting-worker:${IMAGE_TAG:-check}"
WORK="$(mktemp -d "${TMPDIR:-/tmp}/casting-accuracy.XXXXXX")"
cleanup() { # what the worker container wrote belongs to its own user: the container removes it
    $CONTAINER run --rm --user 0 --network none -v "$WORK:/work" --entrypoint sh "$IMAGE" -c 'rm -rf /work/* /work/.[!.]*' >/dev/null 2>&1 || true
    rm -rf "$WORK" 2>/dev/null || true
}
trap cleanup EXIT
chmod 777 "$WORK"

$CONTAINER build -q -t "$IMAGE" casting-worker >/dev/null
if [ "${1:-}" = "--synthetic" ]; then
    mkdir -p "$WORK/corpus"; chmod 777 "$WORK/corpus"
    $CONTAINER run --rm --network none -v "$WORK/corpus:/out" --entrypoint make-samples "$IMAGE" /out >/dev/null
    MANIFEST="casting-worker/accuracy/synthetic.manifest.json"; CORPUS="$WORK/corpus"
elif [ -n "${1:-}" ] && [ -f "$1" ]; then
    MANIFEST="$1"; CORPUS="$(cd "$(dirname "$1")" && pwd)"
else
    echo "usage: $0 --synthetic | <manifest.json>" >&2; exit 64
fi

# One part at a time, in the worker's sandbox: the corpus read-only, only its own result folder writable.
mkdir -p "$WORK/results"
(cd backend && npx ts-node -r tsconfig-paths/register -e '
  const m = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"));
  for (const p of m.parts ?? []) if (typeof p.id === "string" && typeof p.file === "string") console.log(p.id + "\t" + p.file);
' "$(cd .. && realpath "$MANIFEST")") | while IFS=$'\t' read -r id file; do
    case "$id$file" in *..*|/*) echo "skipping $id: ids and files must be plain names inside the corpus" >&2; continue ;; esac
    mkdir -p "$WORK/results/$id"; chmod 777 "$WORK/results/$id"
    $CONTAINER run --rm --network none --read-only --memory 2g --cpus 2 --pids-limit 64 \
        -v "$CORPUS:/in:ro" -v "$WORK/results/$id:/out" "$IMAGE" --deadline-ms 600000 "/in/$file" /out >/dev/null 2>&1 \
        || echo "the worker ended with an error on $id (its result, if any, is judged as it is)" >&2
done

cd backend
npx ts-node -r tsconfig-paths/register scripts/casting-accuracy.ts "$(cd .. && realpath "$MANIFEST")" "$WORK/results"
