# Casting worker

The C++17 / Open CASCADE 8.0.1 geometry worker that reads STEP and measures a part for sand casting: healing, mass
properties, assembly tree, casting geometry (draw axis, parting line, wall thickness, cores) and the casting features
(holes, rings, voids, faces, edges), with 3D output (GLB). Design: petrus-demo `docs/design/sand-casting-module.md`
(decision D150, step S1). Decisions D105–D149 there record how the worker was built.

## Provenance

Copied unchanged from `petrus-demo/geometry-worker` (worker 0.15.0, `schema_version` 1) on 2026-11-04. 0.15.0 adds `casting.wall_mm.faces`: the thinnest wall measured from each face (the same rays as the wall thickness, which now keep the face they started from), so thin walls can be shown where they are. 0.14.0 added `casting.draft`: the draft angle of every face along the draw axis (`src/draft.cpp`, a new file, and two more samples, `taper-3.step` and `taper-04.step`). 0.13.0 added `--draw-axis x|y|z` (measure along the engineer's axis instead of the chosen one) and the result's `casting.draw_axis_source` (`auto` or `requested`); it was first copied as 0.12.0 and the four files that changed (`result.schema.json`, `src/casting.cpp`, `src/main.cpp`, `src/model.hpp`) were copied again, with their hashes.
`PROVENANCE.sha256` holds the SHA-256 of every file **as copied**. The only file edited since is `Dockerfile`: the
`cad-runner` stage and `BACKEND_IMAGE` argument (petrus-demo's Rust runner, not used here) and the schema's install
folder were removed, and the `ninja-build` pin loosened to `1.12.1-1*` (the exact `+b1` build exists only on arm64; CI is amd64). Any other difference from that list is a change to the worker and belongs in its own review:
`cd casting-worker && grep -v " ./Dockerfile$" PROVENANCE.sha256 | shasum -a 256 -c -` (CI runs it).

This is a separate worker from `geometry-worker/` (the assembly measurer `cad-uploads` uses); neither is changed by
the other. Merging them is a later decision.

## The worker host (sand casting module)

Target `host` of the Dockerfile is core's `cad-worker-host` and this worker in one sandboxed container (no network, no credentials, non-root 10005), the way the assembly core runs
its worker: the backend sends a part's STEP bytes over a Unix socket and gets `result.json` and the mesh files back (`backend/src/modules/sand-casting`). The host calls its worker as
`--deadline-ms N <out-dir> <input>...`; this worker takes the output folder last, so `host-adapter.sh` reorders the arguments inside the image (neither program is changed).

```
docker compose -f docker-compose.prod.yml --profile sand-casting up -d casting-worker
CASTING_WORKER_SOCKET=/run/casting-worker/worker.sock    # for the backend; unset: casting analyses stay queued
casting-worker/e2e.sh                                    # a real STEP part through the real host with the backend's client
```

## Checks

```
cd backend && npm ci --legacy-peer-deps
casting-worker/check.sh        # CONTAINER=podman for Podman
```

Builds the image (OCCT is built from source, pinned by commit and checksum; slow the first time), runs the unit tests,
writes synthetic STEP samples with OCCT itself, runs the worker sandboxed (no network, read-only, non-root, memory and
CPU limits) and compares each result with `tests/expected.json` (hand-worked answers) and `result.schema.json`. The
comparison is `backend/scripts/casting-worker-results.ts` (tested in `backend/src/test-tools`), a port of the checker
the worker had in petrus-demo. Customer files are never used or committed.
