# CAD Engine — Architecture

Current state first (updated 2026-10-29); the domain-boundary refactor log of 2026-09-01 follows it (its layout block is corrected; the narrative is historical).

## How a request flows

```
STEP upload (backend runner, or the browser through the backend)
  -> main.py handler (plain `def`: runs in the threadpool, never on the event loop)
     -> analysis_gate (shared/analysis_gate.py): at most MAX_CONCURRENT_ANALYSES at once, otherwise 429 + Retry-After
        -> POST /analyze/assembly : shared/assembly.py reads the STEP through OpenCascade XDE
              (definitions + instances; repeated instances collapse into a quantity; each distinct part once)
              shared/assembly_report.py measures each distinct part and returns the contract JSON
        -> POST /assembly/parts   : a zip with one STEP per requested part id (same files, same order as /analyze/assembly)
        -> POST /analyze/geometry : shared/part_analysis.py analyze_part() (one part: features, DFM, PMI, component features)
        -> POST /measure/geometry : volume, area, bounding box only
```

- **Contract.** `contract/assembly.schema.json` (version 1, additive within a version) is the canonical shape of
  `/analyze/assembly`. The backend keeps a generated copy (`npm run cad:sync-contract`); a backend spec fails when they
  drift. A measurement that cannot be taken is `null` with a code in `problems`, never an invented number.
- **Concurrency and hangs.** The gate bounds concurrent heavy requests. A thread stuck inside OpenCascade cannot be
  cancelled, so a watchdog ends the process (exit code 70) when any request runs longer than
  `ANALYSIS_HARD_LIMIT_SECONDS` (default 900); the container restart policy replaces it and callers retry.
  `/health` reports `limits.max_concurrent_analyses` and `load.{analyses_running, oldest_analysis_seconds}`.
- **Memory.** Measured peak is about 16 MB of RAM per MB of STEP (a 50 MB, 150-part assembly peaks near 800 MB). Size
  `MAX_CONCURRENT_ANALYSES` and the container memory limit together; the compose files default to 1.
- **Limits.** `MAX_FILE_SIZE_MB` (default 100) is the engine's per-file limit and matches the backend
  (`backend/src/common/upload-limits.ts`) and the upload UI.
- **Component-features cache.** `ComponentFeatureCache` (memory LRU + disk, 7 days) is keyed by geometry hash plus a
  digest of `component_feature_analyzer.py`, so a code change invalidates it without a hand-bumped version.
- **Not done on purpose.** A shared topology index for the extractors: typical parts analyse in 0.02–0.8 s, so the
  rewrite of the 4,265-line sheet-metal extractor would risk costing inputs for no measured gain. Revisit only if
  profiling larger parts shows a hot spot.
- **Upload pipeline** (backend side): `backend/src/modules/cad-uploads`, queue table `cad_uploads` (migration 917).

## Layout

```
cad-engine/
  main.py                        — FastAPI entrypoint (stays at root)
  sheet_metal/
    feature_extractor.py         — SheetMetalFeatureExtractor (+ _annotate_tap_candidates)
    bend_relationships.py        — bend-to-bend/flange relationship extraction
    nesting.py                   — real-polygon 2D nesting (Nest View)
  injection_molding/
    feature_extractor.py         — InjectionMoldedFeatureExtractor
  die_casting/
    feature_extractor.py         — die-casting extractor (reached through family_hint="die_cast")
  contract/
    assembly.schema.json         — /analyze/assembly result contract
  machining/
    machining_feature_recognizer.py — MachiningFeature/MachiningFeatureTree/
                                       MachiningFeatureRecognizer orchestration
                                       (renamed 2026-09-19 from cnc_feature_recognizer.py
                                       per the "Machining is the canonical domain,
                                       not CNC" architecture mandate)
    feature_models.py            — MachiningFeatureType/MachiningFeature/MachiningFeatureTree
                                    data shapes (own module since the same rename)
  shared/                        — cross-domain, not owned by one manufacturing family
    machining_geometry.py        — hole/cone/counterbore classification + cylinder
                                    collection primitives, extracted out of Machining
                                    (2026-09-19) since Sheet Metal genuinely depends
                                    on them directly — see below
    component_feature_analyzer.py — ComponentFeatureAnalyzer + detect_part_family()
    assembly.py / assembly_report.py — STEP assembly structure + the /analyze/assembly result
    part_analysis.py             — analyze_part() (the body of /analyze/geometry) + ComponentFeatureCache
    analysis_gate.py             — concurrency gate + hung-request watchdog
    reference_features.json      — the one canonical feature vocabulary (generated; see scripts/)
    drawing_analyzer.py          — 2D drawing/PDF title-block extraction
    memory_optimizer.py          — CAD memory management + extraction orchestration
    sldprt_converter.py          — SolidWorks SLDPRT -> STEP conversion
    services.py / validators.py / config.py / exceptions.py — infrastructure
```

## Why `feature_extractors.py` split the way it did

The file already contained three independent classes with no shared state between
them — it was one file by accident of history, not by design:

- `SheetMetalFeatureExtractor` (former lines 329–4010, ~3,681 lines)
- `InjectionMoldedFeatureExtractor` (former lines 4018–5039)
- `ComponentFeatureAnalyzer` (former lines 5047–5980) — its own docstring says
  "for **any** detected part family," i.e. it was already self-declared as
  cross-domain, not sheet-metal-owned despite living in the same file.
- `detect_part_family()` (former lines 54–321) — classifies which family a part
  belongs to; used only by `memory_optimizer.py`, genuinely cross-domain by
  construction (it decides *between* domains).
- `_annotate_tap_candidates()` (former lines 24–47) — private helper, called only
  from inside `SheetMetalFeatureExtractor`; moved with it.

## Known intentional cross-domain dependency (partially resolved 2026-09-19)

`sheet_metal/feature_extractor.py` and `sheet_metal/features/forming_spike.py`
originally imported these symbols directly from Machining:

```python
from machining.cnc_feature_recognizer import _TAP_DRILL_RANGES
from machining.cnc_feature_recognizer import CNCFeatureRecognizer, CNCFeature, _detect_counterbores, _classify_cone
```

This was real, pre-existing behavior (verified via the import graph before any file
moved) — Sheet Metal genuinely reuses Machining's tap/counterbore/cone
classification logic. It was preserved exactly as-is in the 2026-09-01 refactor:
no wrapper, no duplication, no partial split of `cnc_feature_recognizer.py`.

**2026-09-19 update:** the "move in later" direction below was executed as part
of the "Machining is the canonical domain, not CNC" architecture mandate.
`_TAP_DRILL_RANGES`, `classify_hole`/`_classify_hole`, `classify_cone`/
`_classify_cone`, `detect_counterbores`/`_detect_counterbores`,
`detect_multistep_holes`, and the raw `collect_cylinders` primitive underlying
`_collect_cylinders` are now genuinely domain-neutral, living in
`shared/machining_geometry.py` with **zero import dependency on
`machining.feature_models`** — the direction described below, now real, not
just aspirational. Sheet Metal's two call sites now import from
`machining.machining_feature_recognizer` (which re-exports these
`shared/machining_geometry.py` names unchanged, so this is not a duplicate
implementation), and the class names are `MachiningFeatureRecognizer`/
`MachiningFeature`.

**Not yet moved, still a real cross-domain dependency:** both Sheet Metal call
sites still instantiate `MachiningFeatureRecognizer()` directly to reach its
`_collect_cylinders`/`_collect_cones` *methods* (thin delegating wrappers over
the now-shared functions, kept as methods so this exact call pattern —
`recognizer._collect_cylinders(...)` — didn't need to change). Promoting this
from "instantiate a Machining class" to a true shared free function is real,
further work, not done in this pass.

The direction to move in later (for what remains) is still:

```
Sheet Metal -> domain-neutral shared geometry/feature primitives
```

rather than:

```
Sheet Metal -> Machining
```

Only extract a symbol into `shared/` when it's genuinely cross-domain-owned —
do not move `MachiningFeatureRecognizer` (or the rest of
`machining_feature_recognizer.py`) into `shared/` merely because Sheet Metal
happens to consume part of it today.

## Verification performed (no OCC available in the refactor environment)

`pythonocc-core` isn't installed in every environment this refactor was done in,
so the real import chain (which pulls in `OCC.*`) couldn't be executed directly.
Verification instead used two static, dependency-free checks:

1. `ast.parse()` on every `.py` file in the tree — confirms syntactic validity.
2. A custom import-graph walker (also `ast`-based) that resolves every local
   `from <package> import <name>` / `import <package>...` statement against the
   actual files on disk and confirms the imported name is really defined there
   (including the `from package import submodule_file` pattern, e.g.
   `from shared import sldprt_converter`).

Both passed clean across all 40 `.py` files. This does **not** substitute for
running the real test suite (`test_bend_relationships.py`,
`test_flat_pattern_outline.py`, `test_nesting.py`) in an environment with
`pythonocc-core` installed — do that before treating this refactor as fully
verified in a deploy pipeline.
