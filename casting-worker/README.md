# Casting worker

The C++17 / Open CASCADE 8.0.1 geometry worker that reads STEP and measures a part for sand casting: healing, mass
properties, assembly tree, casting geometry (draw axis, parting line, wall thickness, cores) and the casting features
(holes, rings, voids, faces, edges), with 3D output (GLB). Design: petrus-demo `docs/design/sand-casting-module.md`
(decision D150, step S1). Decisions D105–D149 there record how the worker was built.

## Provenance

Copied unchanged from `petrus-demo/geometry-worker` (worker 0.12.0, `schema_version` 1) on 2026-11-04.
`PROVENANCE.sha256` holds the SHA-256 of every file **as copied**. The only file edited since is `Dockerfile`: the
`cad-runner` stage and `BACKEND_IMAGE` argument (petrus-demo's Rust runner, not used here) and the schema's install
folder were removed, and the `ninja-build` pin loosened to `1.12.1-1*` (the exact `+b1` build exists only on arm64; CI is amd64). Any other difference from that list is a change to the worker and belongs in its own review:
`cd casting-worker && grep -v " ./Dockerfile$" PROVENANCE.sha256 | shasum -a 256 -c -` (CI runs it).

This is a separate worker from `geometry-worker/` (the assembly measurer `cad-uploads` uses); neither is changed by
the other. Merging them is a later decision.

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
