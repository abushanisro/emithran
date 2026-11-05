# CAD core parity on real files

Runs the same zip through both CAD cores and writes down how they differ. It changes neither path and not the production default
(`CAD_CORE=python`); it is the evidence for deciding whether `CAD_CORE=rust` can become one.

```
python3 geometry-worker/tests/real/run.py --out DIR --zip ~/Downloads/liner.zip --zip "~/Downloads/Plastic Components.zip"
python3 geometry-worker/tests/real/run.py --out DIR --only geometry        # one stage; fixtures only
cd geometry-worker/tests/real && python3 -m unittest -q test_compare       # the comparison's own tests
```

Needs Docker, `cargo`, `npm ci --legacy-peer-deps` in `backend/`, and these images (the script prints the build command for a missing
one, and its summary marks an image **STALE** when its sources have a newer commit):

| image | built from |
|---|---|
| `cad-worker:dev` | `geometry-worker/` + core's host (`docker build ... --target worker -t cad-worker:dev core`) |
| `cad-core:dev` | `core/` (the Rust runner) |
| `py-occt:dev` | `geometry-worker/tests/Dockerfile.pyocct` (the Python engine's OCCT stack) |
| `mithran-cad-engine:dev` | `cad-engine/` (the Python engine as a service) |

The harness starts its own throwaway `cad-engine` on port 5056 with a key of its own (`--engine-url` to use another), so a developer's running
engine and `.env` are never touched.

## Stages

Each tests one component alone, so a failure is attributed to the component that caused it.

| stage | compares | with |
|---|---|---|
| `archive` | the Rust extractor (`core/crates/archive`) and the backend's (`expand-archive.ts`) | a plain zip reader, then each other: entries, bytes, order, skipped files and why |
| `geometry` | the C++ `geometry-worker` and the Python engine's `build_report` on the same STEP files | tree, quantities, volume, area, bounding boxes, status, problems, per field |
| `exports` | each side's exported part files, reopened as files of their own and measured by the same code | the report's own measurements, and each other (never byte equality) |
| `e2e` | the whole path: the backend's real `CadUploadRunner` with `CAD_CORE=python` (live engine) and `CAD_CORE=rust` (the real `cad-runner` and `cad-worker` containers, via `core/tests/e2e.py`'s stand-in data API) | the report, the BOM lines created (type, parent, quantity, measurements) and the files stored |

Cases: the repository's fixtures (nested assembly alone and inside a pack with loose parts, a pack with a corrupt STEP file, a pack with no CAD
file) always run; `--zip` adds real files, which are read from where they are and never copied into the repository.

## Reading the result

Every difference is one finding with a category: `missing_field` (a key on one side only), `structure` (tree, ids, names, counts), `quantity`,
`geometry` (volume, area, box beyond the tolerance: 0.1% relative, 1e-3 absolute), `processing` (status, problems, a process that failed or
crashed, a different refusal), `export`, `archive`, `bom`. `DIR/diff.json` has all of them, `DIR/<case>/<stage>/` the raw reports, and
`DIR/summary.md` the table, timings, the largest relative difference seen per measurement (also among values that agree, to show how close
"passing" is), configuration differences found by reading both sources, and the images' provenance.

Not measured: memory, crash rates over many files, and real nested assembly files from a customer (the repository's own fixture is the only
nested assembly). Timings on Apple Silicon include amd64 emulation and are indicative only.
