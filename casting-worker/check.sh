#!/bin/sh
# Casting worker check: builds the image, writes synthetic STEP samples with OCCT itself, runs the worker the way
# production will (no network, read-only root file system, non-root, memory and CPU limits, input read-only) and
# compares every result with the hand-worked answers in tests/expected.json and with result.schema.json.
# Never uses customer files. CONTAINER=podman for Podman. Needs `npm ci` in backend/ (the comparison runs there).
set -eu
cd "$(dirname "$0")/.."
CONTAINER="${CONTAINER:-docker}"
IMAGE="casting-worker:${IMAGE_TAG:-check}"
WORK=".cache/casting-worker-check-$$"
trap 'rm -rf "$WORK"' EXIT
mkdir -p "$WORK/samples"
compare() { (cd backend && npx ts-node -r tsconfig-paths/register scripts/casting-worker-results.ts "$@"); }

pass() { echo "PASS  $1"; }
fail() { echo "FAIL  $1"; exit 1; }
# The worker in its sandbox: samples read-only at /in, only /out writable. Extra run options first.
worker() {
    $CONTAINER run --rm --network none --read-only --memory 2g --cpus 2 --pids-limit 64 \
        -v "$PWD/$WORK/samples:/in:ro" "$@"
}
# Runs one sample, keeping exit code, stdout and result.json in $WORK/results.
run_sample() { # <sample stem> [worker options...]
    stem="$1"; shift
    mkdir -p "$WORK/results/$stem"; chmod 777 "$WORK/results/$stem"   # the worker runs as a different uid
    set +e
    worker -v "$PWD/$WORK/results/$stem:/out" "$IMAGE" "$@" "/in/$stem.step" /out > "$WORK/results/$stem.out"
    echo $? > "$WORK/results/$stem.exit"
    set -e
}

echo "== build $IMAGE"
$CONTAINER build -q -t "$IMAGE" casting-worker >/dev/null

echo "== unit tests (validity and healing)"
$CONTAINER run --rm --network none --read-only --entrypoint unit-tests "$IMAGE"

echo "== synthetic samples"
$CONTAINER run --rm --network none -v "$PWD/$WORK/samples:/out" --entrypoint make-samples "$IMAGE" /out
printf 'ISO-10303-21;\nHEADER;\nthis is not a valid STEP file\n' > "$WORK/samples/corrupt.step"
printf 'PK\003\004 not STEP at all' > "$WORK/samples/not-step.step"
# An imprecise export: one vertex of the box moved 0.5 mm off its edges (still a solid, no longer valid).
compare shift-vertex "$PWD/$WORK/samples/box.step" > "$WORK/samples/shifted-vertex.step"
grep -q "INCH" "$WORK/samples/box-inch.step" && grep -q "3.937" "$WORK/samples/box-inch.step" \
    && pass "box-inch.step is really written in inches (3.937 in = 100 mm)" || fail "box-inch.step is not in inches"
ls "$WORK/samples"

echo "== read and measure"
for f in "$WORK"/samples/*.step; do stem="$(basename "$f" .step)"; run_sample "$stem"; done
# Several files, one product: compared as "several.step".
mkdir -p "$WORK/results/several"; chmod 777 "$WORK/results/several"
set +e
worker -v "$PWD/$WORK/results/several:/out" "$IMAGE" /in/box.step /in/assembly.step /in/bolt.step /in/not-step.step /out \
    > "$WORK/results/several.out"
echo $? > "$WORK/results/several.exit"
set -e
for f in corrupt not-step; do
    [ "$(cat "$WORK/results/$f.exit")" = 2 ] && [ "$(cat "$WORK/results/$f.out")" = '{"error":"unreadable_step"}' ] \
        && pass "$f.step: unreadable_step, exit 2" || fail "$f.step: exit $(cat "$WORK/results/$f.exit")"
done
compare compare "$PWD/casting-worker/tests/expected.json" "$PWD/$WORK/results" "$PWD/casting-worker/result.schema.json"

echo "== limits"
run_sample assembly --deadline-ms 1
mv "$WORK/results/assembly.out" "$WORK/deadline.out"; mv "$WORK/results/assembly.exit" "$WORK/deadline.exit"
[ "$(cat "$WORK/deadline.exit")" = 4 ] && [ "$(cat "$WORK/deadline.out")" = '{"error":"deadline_exceeded"}' ] \
    && pass "a 1 ms deadline stops the worker: deadline_exceeded, exit 4" || fail "deadline: exit $(cat "$WORK/deadline.exit")"
for bad in 0 -5 10x 99999999 ''; do
    set +e; worker "$IMAGE" --deadline-ms "$bad" /in/box.step /tmp >/dev/null 2>&1; rc=$?; set -e
    [ "$rc" = 64 ] || fail "deadline '$bad' accepted (exit $rc)"
done
pass "invalid deadlines (0, -5, 10x, 99999999, empty) are refused: exit 64"
[ -z "$(find "$WORK/results" -name '*.tmp')" ] && pass "no half-written result.json.tmp left behind" || fail "temporary result file left"
set +e; out="$(worker -v "$PWD/$WORK/samples:/out:ro" "$IMAGE" /in/box.step /out)"; rc=$?; set -e
[ "$rc" = 5 ] && [ "$out" = '{"error":"cannot_write_result"}' ] \
    && pass "a read-only output folder: cannot_write_result, exit 5" || fail "unwritable output: exit $rc, $out"

echo "== image"
$CONTAINER run --rm --entrypoint ls "$IMAGE" /usr/share/licenses/occt | grep -q OCCT_LGPL_EXCEPTION.txt \
    && pass "OCCT licence texts are in the image" || fail "licence texts missing"
[ "$($CONTAINER run --rm --entrypoint id "$IMAGE" -u)" = 65532 ] && pass "runs as non-root (uid 65532)" || fail "user"

echo "== casting worker check: all checks passed"
