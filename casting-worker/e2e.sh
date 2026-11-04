#!/bin/sh
# End to end: the casting worker host (target `host`) in its production sandbox (no network, read-only, non-root), a real STEP file through
# the backend's own WorkerHostClient over the Unix socket, the result checked against the worker's contract. Needs `npm ci` in backend/.
# Builds both images (the worker's `check` image is cached by check.sh in CI). CONTAINER=podman for Podman.
set -eu
cd "$(dirname "$0")/.."
CONTAINER="${CONTAINER:-docker}"
ID="casting-e2e-$$"
WORK=".cache/$ID"
cleanup() { $CONTAINER rm -f "$ID-host" >/dev/null 2>&1 || true; $CONTAINER volume rm "$ID-sock" >/dev/null 2>&1 || true; rm -rf "$WORK"; }
trap cleanup EXIT
mkdir -p "$WORK/samples"; chmod 777 "$WORK/samples"

echo "== build the host and the worker"
$CONTAINER build -q --target host --build-context core=core -t casting-worker-host:check casting-worker >/dev/null
$CONTAINER build -q -t casting-worker:check casting-worker >/dev/null

echo "== a good STEP part and a corrupt one"
$CONTAINER run --rm --network none -v "$PWD/$WORK/samples:/out" --entrypoint make-samples casting-worker:check /out >/dev/null 2>&1
printf 'ISO-10303-21;\nHEADER;\nthis is not a valid STEP file\n' > "$WORK/samples/corrupt.step"
[ -s "$WORK/samples/holes.step" ] || { echo "FAIL  no sample written"; exit 1; }

echo "== start the host (no network, read-only, non-root, memory and pid limits)"
$CONTAINER volume create "$ID-sock" >/dev/null
$CONTAINER run -d --name "$ID-host" --network none --read-only --user 10005:10005 --cap-drop ALL --security-opt no-new-privileges \
    --memory 2g --cpus 2 --pids-limit 128 --tmpfs /tmp:size=1g,uid=10005,gid=10005,mode=0700 -e WORKER_MEMORY_MB=1536 \
    -v "$ID-sock:/run/cad-worker" casting-worker-host:check >/dev/null
for _ in $(seq 1 60); do $CONTAINER exec "$ID-host" cad-worker-host health >/dev/null 2>&1 && break; sleep 1; done
$CONTAINER exec "$ID-host" cad-worker-host health >/dev/null 2>&1 && echo "PASS  the host accepts a connection on its socket" || { echo "FAIL  the host did not come up"; $CONTAINER logs "$ID-host" | tail -5; exit 1; }

echo "== the backend's client, in a container with the socket volume and the worker's group (as the backend runs)"
$CONTAINER run --rm --network none --user 1000:1000 --group-add 10005 -v "$ID-sock:/run/casting-worker" -v "$PWD/backend:/app:ro" -v "$PWD/$WORK/samples:/samples:ro" \
    -w /app docker.io/library/node:24-slim sh -c 'node -r ts-node/register/transpile-only -r tsconfig-paths/register scripts/casting-worker-e2e.ts /run/casting-worker/worker.sock /samples/holes.step /samples/corrupt.step /samples/hollow-box.step'
echo "== casting worker e2e: all checks passed"
