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
# What the worker container wrote belongs to uid 65532, which the runner cannot remove: the container removes it, as root.
cleanup() {
    $CONTAINER run --rm --user 0 --network none -v "$PWD/$WORK:/work" --entrypoint rm "$IMAGE" -rf /work/samples /work/results 2>/dev/null || true
    rm -rf "$WORK"
}
trap cleanup EXIT
mkdir -p "$WORK/samples"; chmod 777 "$WORK/samples"   # the worker container runs as uid 65532, not the runner user (Linux bind mounts keep the host owner)
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

echo "== draw axis (the engineer's choice)"
# hollow-box.step is a 100 x 60 x 40 mm block with a closed cavity: along x, y, z the part is 100, 60, 40 mm deep. Chosen by the worker: x (the fewest
# hidden regions, then the shallowest); requested: the asked axis, and the result says so.
axis_case() { # <axis or auto> <expected axis> <expected source> <expected depth mm>
    ask="$1"; want="$2 $3 $4"; mkdir -p "$WORK/results/axis-$ask"; chmod 777 "$WORK/results/axis-$ask"
    if [ "$ask" = auto ]; then set --; else set -- --draw-axis "$ask"; fi
    worker -v "$PWD/$WORK/results/axis-$ask:/out" "$IMAGE" "$@" /in/hollow-box.step /out >/dev/null || fail "draw axis $ask: the worker failed"
    got="$(node -e 'const c=JSON.parse(require("fs").readFileSync(process.argv[1])).parts[0].casting;console.log(c.draw_axis,c.draw_axis_source,c.draw_depth_mm)' "$WORK/results/axis-$ask/result.json")"
    [ "$got" = "$want" ] && pass "draw axis $ask: $got" || fail "draw axis $ask: got '$got', expected '$want'"
}
axis_case auto x auto 100
axis_case x x requested 100
axis_case y y requested 60
axis_case z z requested 40
for bad in w X xy ''; do
    set +e; worker "$IMAGE" --draw-axis "$bad" /in/box.step /tmp >/dev/null 2>&1; rc=$?; set -e
    [ "$rc" = 64 ] || fail "draw axis '$bad' accepted (exit $rc)"
done
pass "an invalid draw axis (w, X, xy, empty) is refused: exit 64"

echo "== draft angle (S4): every face's angle to the draw axis, worked by hand from the geometry"
# The angle of a face is 0 when parallel to the draw axis, positive when it tapers away from the parting plane, negative for an undercut; a flat floor or roof
# is 90 (free). Expected: the faces grouped by min..max angle, with their count.
draft_case() { # <sample stem> <expected groups> <why>
    got="$(node -e '
        const d = JSON.parse(require("fs").readFileSync(process.argv[1])).parts[0].casting.draft;
        if (!d || d.unmeasured !== 0 || d.at_parting_plane !== 0) { console.log("unexpected: " + JSON.stringify(d && { unmeasured: d.unmeasured, at: d.at_parting_plane })); process.exit(0); }
        const r = (x) => Math.round(x * 1e4) / 1e4, g = new Map();
        for (const f of d.faces) { const k = r(f.min_deg) + ".." + r(f.max_deg); g.set(k, (g.get(k) || 0) + 1); }
        console.log([...g].sort((a, b) => parseFloat(a[0]) - parseFloat(b[0])).map(([k, n]) => k + ":" + n).join(","));
    ' "$WORK/results/$1/result.json")"
    [ "$got" = "$2" ] && pass "draft $1: $got ($3)" || fail "draft $1: got '$got', expected '$2' ($3)"
}
draft_case box "0..0:4,90..90:2" "four vertical walls, a floor and a roof"
draft_case cylinder "0..0:1,90..90:2" "one vertical side, a floor and a roof"
draft_case tube "0..0:2,90..90:2" "two vertical sides (outer and bore), a floor and a roof"
draft_case step-block "0..0:5,90..90:3" "five vertical faces of the L, three horizontal ones"
draft_case hollow-box "-90..-90:2,0..0:8,90..90:2" "the two ends of the closed cavity face each other: both undercut (this is why it needs a core); eight walls along x"
draft_case taper-3 "3..3:1,90..90:2" "a cone leaning 3 degrees from the axis: the side is exactly 3, drafted"
draft_case taper-04 "0.4..0.4:1,90..90:2" "the same at 0.4 degrees, under the 0.5 degree limit of the published rules"

echo "== undercuts (S5): the faces that cannot be withdrawn along each axis, worked by hand from the geometry"
# A point is an undercut when it cannot be withdrawn up or down the axis (the way it faces, and metal in the line out). Expected: the number of undercut
# faces along x, y and z.
undercut_case() { # <sample stem> <expected "x,y,z" face counts> <why>
    got="$(node -e '
        const u = JSON.parse(require("fs").readFileSync(process.argv[1])).parts[0].casting.undercuts;
        console.log(u ? u.axes.map((a) => a.faces.length).join(",") : "null");
    ' "$WORK/results/$1/result.json")"
    [ "$got" = "$2" ] && pass "undercuts $1: $got ($3)" || fail "undercuts $1: got '$got', expected '$2' ($3)"
}
undercut_case box "0,0,0" "a plain block needs no core along any axis"
undercut_case cylinder "0,0,0" "a cylinder is free along its axis and across it"
undercut_case plate-with-hole "1,1,0" "a hole through along z: free along z, but across it the bore's wall is hidden from both sides"
undercut_case hollow-box "6,6,6" "a closed cavity: its six faces cannot be withdrawn along any axis"
undercut_case slot-block "0,5,5" "a slot open at one end along x: free along x, but along y and z its five faces are hidden"

echo "== wall thickness by face (S6): the thinnest wall measured from each face, worked by hand from the geometry"
# From a point of a face the distance through the metal along the inward normal to the next surface; per face, the smallest. Expected: the faces grouped by that thickness (mm), with their count.
wall_case() { # <sample stem> <expected groups> <why>
    got="$(node -e '
        const w = JSON.parse(require("fs").readFileSync(process.argv[1])).parts[0].casting.wall_mm;
        const g = new Map();
        for (const f of w.faces) { const k = Math.round(f.min * 1e3) / 1e3; g.set(k, (g.get(k) || 0) + 1); }
        console.log([...g].sort((a, b) => a[0] - b[0]).map(([k, n]) => k + ":" + n).join(","));
    ' "$WORK/results/$1/result.json")"
    [ "$got" = "$2" ] && pass "wall $1: $got ($3)" || fail "wall $1: got '$got', expected '$2' ($3)"
}
wall_case box "20:2,50:2,100:2" "100 x 50 x 20: through the 20, the 50 and the 100"
wall_case cylinder "40:2,50:1" "radius 25, height 40: the ends through the 40, the side across the 50 diameter"
wall_case tube "10:2,50:2" "outer radius 30, bore 20, height 50: the wall is 10 from both sides, the ends are 50"
wall_case hollow-box "10:4,20:8" "100 x 60 x 40 with a 60 x 20 x 20 cavity: the faces over the cavity (top, bottom, and the cavity's own) are 10, the other eight 20"
wall_case step-block "20:2,40:1,50:2,60:2,100:1" "the L step: bottom and step top 20, the high top 40, the left side and the riser 50, front and back 60, the right side 100"

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
