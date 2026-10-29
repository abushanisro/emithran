# Assembly core

How an uploaded ZIP / STEP assembly becomes BOM items. Modeled on Petrus (`petrus-demo/`): the code that parses CAD is a small
separate process; everything around it is supervised, bounded and verified.

```
NestJS upload (check, sha256, store, insert row)  ->  cad_uploads  queued
core/crates/runner  `cad-runner`   queued -> running -> analysed
    claim_next_cad_upload() RPC -> download -> unzip (core/crates/archive, hard caps) -> geometry-worker (deadline, empty env, prlimit)
    -> result.json parsed into core/crates/domain types and checked by domain::verify() -> one STEP file per distinct part stored
NestJS materializer                analysed -> materializing -> done
    claim_next_analysed_upload() RPC (migration 923) -> planItems -> createItems (BOM rules, audit, file paths) -> remove work files
```
The runner talks to Supabase over HTTPS only (PostgREST + Storage, secret key): no Postgres connection, like the rest of the backend.
`CAD_CORE=python` (default) keeps the old path (NestJS calls the Python `cad-engine`); `CAD_CORE=rust` makes NestJS materialize only and
`cad-runner` analyse. Exactly one analyser may run for a deployment.

## Statuses (migration 923)
`queued -> running -> analysed -> materializing -> done`, `failed` from any step. `running` is claimed by the analysis runner (stale after
1800 s, 3 attempts); `materializing` by the materializer (stale after 900 s, 3 `materialize_attempts`). The two never claim each other's rows.

## geometry-worker contract
`geometry-worker --deadline-ms <ms> <out_dir> <file1.step> [file2.step ...]`
- Inputs are named `NNNN_<basename>` (position first): part ids start with the file's position, so ids are unique across files.
- Runs with an **empty environment**, no network use, no credentials. Writes only under `<out_dir>`.
- Reads each file with XDE (`STEPCAFControl_Reader`), builds the tree, collapses instances of one definition under one parent into a quantity,
  measures each distinct part once, and writes:
  - `<out_dir>/result.json`, **atomically** (temp file, fsync, rename): the version-1 report, `cad-engine/contract/assembly.schema.json`.
  - `<out_dir>/parts/<definition with ':' as '_'>.step` for every distinct part (`<out_dir>/parts/` already exists).
- A measurement it cannot take is `null` plus a problem code (`invalid_geometry`, `failed:measure`, `empty_assembly`), never a guess.
- Exit codes: `0` ok; `2` no file could be read (`unreadable_step`, permanent); `3` no solids (`no_solids`, permanent);
  `4` its own deadline (retryable); `6` analysis failed (retryable); anything else, or a signal, is a crash (retryable).
  A short human message goes to stderr (the runner keeps the last 300 bytes). The runner kills it `grace` after the deadline.
- Depth is bounded at 64 levels; a root already contained in another file's assembly is marked `inside` and not counted twice.

## Rules inherited from Petrus
A wrong number is worse than a missing one (D107). The API never parses CAD (D118). Strict process contract and atomic result (D109).
Every analysis step is checked against hand-worked answers on synthetic STEP (D126). The worker's output is verified before it is stored.

## Licensing
Open CASCADE (LGPL-2.1 with exception) is linked **dynamically** into `geometry-worker`; the runtime image ships its shared libraries and
the library's licence text. The Rust crates and NestJS code do not link OCCT.

## True-shape nesting (`core/crates/nesting`, binary `nester`)
The Rust port of `cad-engine/sheet_metal/nesting.py`: extreme-point bottom-left-fill with exact polygon collision, one part type per sheet.
Its answer feeds material cost (`true-nest-costing.engine.ts`), so the port keeps the algorithm and its rules exactly: the same anchors and
order, rotation order, kerf-offset anchors, dead-anchor rule, `max_evaluations` cap (150 000) and `capped` flag, shapely's rotation
arithmetic and Python's `round`. What changed is the cost of a step: the collision test compares only the edges inside the overlap
window of two parts, stops at the first conflicting pair and never builds grown (buffered) shapes (two parts conflict at clearance
`kerf` exactly when they are closer than `kerf`).

- **Contract:** the body of cad-engine's `POST /nest` on stdin (plus optional `max_evaluations`); stdout is `{"ok":true,"result":{...}}`
  or `{"ok":false,"reason":"..."}` (the Python 422, same wording). `--deadline-ms` makes it stop and answer `capped:true` with what it
  placed. Exit 0 answered, 64 bad arguments, 65 bad request.
- **NestJS:** `common/nesting/nester.ts` runs it as a child process: empty environment, deadline, SIGKILL backstop, a process-wide
  concurrency limit (`NESTER_CONCURRENCY`, default half the cores), output capped. `CADAnalysisService.computeTrueNest` uses it when
  `NESTING_ENGINE=rust`; a refusal about the part is final, an *unavailable* nester (missing binary, crash, timeout) falls back to the
  Python endpoint. Settings: `NESTING_ENGINE` (`python` default), `NESTER_BIN` (`/usr/local/bin/nester`), `NESTER_TIMEOUT_MS` (60 000).
  The backend image builds the binary in a Rust Alpine stage (`--build-context core=core`).
- **Parity (the gate for removing Python):** `core/crates/nesting/tests/differential.py` runs seeded random cases (rectangles, L, T,
  trapezoids, stars, wavy and 24-gon outlines; four sheets, kerfs 0-3 mm, margins 0-5 mm, five rotation sets) through both nesters and
  compares refusal vs result, `parts_per_sheet`, every placement, utilization, `sheets_required` and `capped`. 600/600 identical, plus the
  heavy cases (53x123 mm on 2500x5000 mm: 1900 and 1793 parts; an L: 3880 parts; 240-480-vertex gears). CI runs 300 cases + heavy.
  Two bugs this found and fixed: a circle's vertices differ by 1e-15 from their twin's (so containment must only be trusted when the
  boundaries are clearly apart), and the 32-bit overlay engine's rounding exceeds the 1e-6 mm2 overlap threshold (the area path uses the
  64-bit one).
- **Speed** (same machine, one request, process start included): 15x-166x faster on the simple heavy cases; 96x-127x on 240-300-vertex
  outlines; 4x on a 480-vertex outline at zero kerf (touching neighbours go through an exact overlap area; a known follow-up).
- **Rollout:** stage `NESTING_ENGINE=rust`, compare costs on real parts, then production; remove `nesting.py`, the `/nest` endpoint and
  the fallback only after production benchmarks. Known differences from Python, all at the edge: a self-intersecting outline is repaired
  with an exact union (shapely's `buffer(0)`) and holes in the repaired outline are ignored; the collision distance tolerance is 1e-6 mm
  where shapely's grown polygons approximate arcs to about 0.005 mm.
