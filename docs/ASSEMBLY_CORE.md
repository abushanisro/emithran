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
