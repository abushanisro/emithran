# cad-engine — OpenCASCADE (pythonocc-core) Binding Standards

Applies to: `cad-engine/` (pythonocc-core `7.7.2`, pinned in `cad-engine/Dockerfile` via
`conda install -c conda-forge pythonocc-core=7.7.2`).

Every claim in this document was verified by direct execution against the actual installed
`pythonocc-core==7.7.2` in this repo's `mithran` conda environment — not inferred from
pythonocc-core's general documentation, changelog, or any third-party writeup. Where a
plausible-sounding recommendation turned out to be wrong for this specific build, that's
recorded below too, so it doesn't get reintroduced later.

## 1. Deprecated procedural calls → real replacement

pythonocc-core `7.7.1+` deprecates the flat procedural wrapper functions in favor of
lowercase **namespace objects** exposing the same methods as static-style calls:

| Deprecated (still works, warns) | Correct replacement | Verified |
|---|---|---|
| `brepbndlib_Add(shape, box)` | `brepbndlib.Add(shape, box)` | ✅ live, zero warnings, identical output |
| `brepgprop_VolumeProperties(shape, props)` | `brepgprop.VolumeProperties(shape, props)` | ✅ live, zero warnings, identical output |
| `brepgprop_SurfaceProperties(shape, props)` | `brepgprop.SurfaceProperties(shape, props)` | ✅ already the convention used throughout `feature_extractors.py` |

```python
# Correct imports
from OCC.Core.BRepBndLib import brepbndlib      # namespace object, NOT a class
from OCC.Core.BRepGProp import brepgprop        # namespace object, NOT a class

brepbndlib.Add(shape, box)
brepgprop.VolumeProperties(shape, props)
```

**⚠️ A commonly-circulated "modernization" claim is wrong for this build — do not reintroduce it.**
Title-case classes (`BRepBndLib`, `BRepGProp`, `BRepGProp_VolumeProperties`) are sometimes cited
online as "the 2026 static-class standard." In `pythonocc-core==7.7.2` **none of these exist**:

```
>>> from OCC.Core.BRepBndLib import BRepBndLib
ImportError: cannot import name 'BRepBndLib' from 'OCC.Core.BRepBndLib'
>>> from OCC.Core.BRepGProp import BRepGProp
ImportError: cannot import name 'BRepGProp' from 'OCC.Core.BRepGProp'
>>> from OCC.Core.BRepGProp import BRepGProp_VolumeProperties
ImportError: cannot import name 'BRepGProp_VolumeProperties' from 'OCC.Core.BRepGProp'
```
Code built around those names fails at import time. This is very plausibly confusion with
**OCP** (a different, separate Python/OCCT binding project with genuinely different, more
C++-mirrored naming) — the two are not interchangeable, and this repo uses pythonocc-core.
Before adopting any "modern OCC" naming advice from an external source, verify the exact
symbol imports in `cad-env`/`mithran` first — the confident tone of a suggestion is not
evidence it matches this specific binding.

**Fixed in this repo:** `cad-engine/shared/memory_optimizer.py` (imports + all 9 call sites:
lines originally 313/321/387/790/992/1000/1008/1016 pre-fix, before the 2026-09-01 domain
split moved this file to `shared/` and renumbered it — see `cad-engine/ARCHITECTURE.md`).
`SheetMetalFeatureExtractor`/`InjectionMoldedFeatureExtractor` (former `feature_extractors.py`,
now split into `cad-engine/sheet_metal/feature_extractor.py` and
`cad-engine/injection_molding/feature_extractor.py`) already used the correct
lowercase-namespace pattern before this fix and needed no change.

## 2. Exception handling around untrusted STEP-derived geometry

**Verified, non-obvious finding:** `OCC.Core.Standard.Standard_Failure` does **not** inherit
from Python's `Exception` (`Standard_Failure.__mro__` is
`(Standard_Failure, Standard_Transient, object)`). A bare `except Standard_Failure:` clause,
suggested by some "hardening" advice as the correct way to catch internal OCC/OCCT errors, is
not merely unnecessary here — it is **dead code that will never fire**, because:

```
>>> gp_Dir(0.0, 0.0, 0.0)   # a real, well-known OCC C++-level Standard_ConstructionError
RuntimeError: Standard_ConstructionErrorgp_Dir() - input vector has zero norm
              raised from method gp_Dir of class gp_Dir
```

pythonocc-core's SWIG binding re-raises internal OCCT C++ failures as a plain Python
**`RuntimeError`** — a normal `Exception` subclass. This means:

- The existing `except Exception as e:` blocks already present throughout `cad-engine`
  (e.g. `memory_optimizer.py`'s `analyze_and_optimize`) **already correctly catch real
  OCCT-internal failures**. No additional `except Standard_Failure` clause is needed, and
  adding one in place of (rather than alongside) `except Exception` would be a regression —
  it would silently stop catching the actual exception type OCCT failures surface as.
- Do not remove or narrow existing `except Exception` handlers around OCC calls on this
  basis. If you need to distinguish "genuine OCCT failure" from "a bug in our own code,"
  match on the message/type of the caught `RuntimeError`, not on `Standard_Failure`.

## 3. Null-shape guard at the trust boundary

Added one check, at the one place it earns its keep: the top of
`AdvancedCADMemoryOptimizer.analyze_and_optimize()` — the real entry point untrusted,
uploaded STEP-derived shapes reach before any hashing/tessellation/analysis begins.

```python
if shape is None or shape.IsNull():
    raise ValueError("analyze_and_optimize received a null/empty TopoDS_Shape -- "
                      "the STEP file likely failed to parse into valid geometry")
```

This is deliberately **not** repeated at every internal helper (`_analyze_geometry_advanced`,
`_detect_holes_real`, etc.) — those are only ever reached via this one entry point in
practice, so a guard at every call site would be redundant defense with no real additional
coverage, not genuine robustness. Check once, at the boundary where untrusted input actually
enters the module.

## 4. `Bnd_Box.SetGap()` — real, but not applied

`Bnd_Box.SetGap(tolerance)` exists and is callable in this build. It was **not** added to any
bounding-box call in this pass: it changes every downstream bbox extent by the given amount,
which is a real numeric behavior change to a costing-adjacent pipeline (part
dimensions/areas/weights ultimately derive from these boxes), and no concrete problem was
observed that it would fix. Do not add it speculatively — if a real numerical-precision issue
with bounding boxes shows up (e.g. STEP files from a specific CAD source producing
zero-thickness mathematical artifacts), reach for `SetGap` then, with the specific failing
case as justification, not as a blanket "best practice" applied without a problem to solve.

## Verification performed

All of the above was checked by actually running code against this repo's `mithran` conda
environment (`pythonocc-core==7.7.2`), not asserted from general OCC knowledge:

- `brepbndlib.Add` / `brepgprop.VolumeProperties` — confirmed callable, confirmed the
  title-case alternatives are not importable, confirmed zero `DeprecationWarning`s fire with
  `warnings.simplefilter("error", DeprecationWarning)` promoted across
  `AdvancedCADMemoryOptimizer._analyze_geometry_advanced`, `_detect_holes_real`, and
  `_analyze_manufacturing_features` on a real box-with-hole shape, with numerically correct
  output (volume/surface-area matched hand-calculated expected values).
- `Standard_Failure` MRO and the `RuntimeError`-wrapping behavior — confirmed via a real
  OCCT-raised error (`gp_Dir(0,0,0)`), not assumed.
- The null-shape guard — confirmed it rejects a genuine null `TopoDS_Shape` with a clear
  `ValueError`, and confirmed a valid shape still processes correctly end-to-end through the
  real `analyze_and_optimize` public entry point afterward (no regression).
