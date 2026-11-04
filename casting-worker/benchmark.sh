#!/usr/bin/env bash
# Timing and memory of the casting worker on assemblies of distinct drilled plates (design step S9; make-samples --big): one run per size, in the production
# sandbox (no network, read-only root, 2 GB, 2 CPUs), each part a 200 x 150 x 20 mm plate with 80 holes, so no part is an instance of another. Prints one row
# per size: the STEP file, the wall time, the time per part, the worker's own stage times (read, analyse, mesh, casting), the peak memory of the container (cgroup),
# and whether every part got its casting measurements. Nothing here is a pass/fail gate: it is a measurement. The numbers depend on the machine; CI is amd64.
#   casting-worker/benchmark.sh              sizes 1 10 30
#   casting-worker/benchmark.sh 1 150        the sizes given (150 takes minutes)
set -euo pipefail
cd "$(dirname "$0")/.."
CONTAINER="${CONTAINER:-docker}"
IMAGE="casting-worker:${IMAGE_TAG:-check}"
WORK="$(mktemp -d "${TMPDIR:-/tmp}/casting-benchmark.XXXXXX")"
cleanup() { $CONTAINER run --rm --user 0 --network none -v "$WORK:/work" --entrypoint sh "$IMAGE" -c 'rm -rf /work/* /work/.[!.]*' >/dev/null 2>&1 || true; rm -rf "$WORK" 2>/dev/null || true; }
trap cleanup EXIT
chmod 777 "$WORK"
$CONTAINER build -q -t "$IMAGE" casting-worker >/dev/null
sizes=("$@"); [ ${#sizes[@]} -gt 0 ] || sizes=(1 10 30)
echo "| parts | STEP MB | wall s | s per part | read s | analyse s | mesh s | casting s | peak MB | measured | problems |"
echo "|---|---|---|---|---|---|---|---|---|---|---|"
for n in "${sizes[@]}"; do
    dir="$WORK/n$n"; mkdir -p "$dir/in" "$dir/out"; chmod 777 "$dir" "$dir/in" "$dir/out"
    $CONTAINER run --rm --network none -v "$dir/in:/out" --entrypoint make-samples "$IMAGE" --big /out "$n" >/dev/null 2>&1
    mb="$(node -e 'console.log((require("fs").statSync(process.argv[1]).size / 1048576).toFixed(1))' "$dir/in/big-assembly.step")"
    start="$(node -e 'console.log(Date.now())')"
    peak="$($CONTAINER run --rm --network none --read-only --memory 2g --cpus 2 --pids-limit 64 -v "$dir/in:/in:ro" -v "$dir/out:/out" --entrypoint sh "$IMAGE" -c \
        '/usr/local/bin/geometry-worker --deadline-ms 3000000 /in/big-assembly.step /out > /out/stdout.json; for f in /sys/fs/cgroup/memory.peak /sys/fs/cgroup/memory/memory.max_usage_in_bytes; do [ -r $f ] && { cat $f; break; }; done' || echo 0)"
    end="$(node -e 'console.log(Date.now())')"
    node -e '
        const [resultPath, n, mb, start, end, peak] = process.argv.slice(1);
        const r = require(resultPath), d = r.diagnostics, wall = (end - start) / 1000;
        const measured = r.parts.filter((p) => p.casting).length, problems = r.parts.filter((p) => p.problems && p.problems.length).length;
        const f = (x, k = 1) => Number(x).toFixed(k);
        console.log(`| ${n} | ${mb} | ${f(wall)} | ${f(wall / n, 2)} | ${f(d.read_seconds, 2)} | ${f(d.analyse_seconds, 2)} | ${f(d.mesh_seconds, 2)} | ${f(d.casting_seconds, 1)} | ${f(Number(peak) / 1048576, 0)} | ${measured} of ${r.parts.length} | ${problems} |`);
    ' "$dir/out/result.json" "$n" "$mb" "$start" "$end" "$peak"
done
