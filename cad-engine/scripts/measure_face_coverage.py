"""
Measure machining face coverage over a folder of real STEP files.

Runs each file through the production path -- StepReader -> the memory
optimizer's family detection -> MachiningFeatureRecognizer -- and reports, for
every part the engine classifies as machined, how many B-Rep faces (and how
much surface area) the recognized features explain, plus the unexplained faces
grouped by surface type. Sheet-metal and molded parts are listed and skipped.

    python scripts/measure_face_coverage.py /corpus [--json out.json]

Inside the dev container, mount the corpus read-only, e.g.
    docker compose -f docker-compose.dev.yml --profile test run --rm \
        -v /mnt/c/Users/<you>/Downloads:/corpus:ro tests \
        conda run --no-capture-output -n cad-env python scripts/measure_face_coverage.py /corpus
"""
from __future__ import annotations

import argparse
import json
import signal
import time
import sys
import tempfile
from collections import Counter
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from shared.part_family import MACHINING_FAMILIES  # noqa: E402
from shared.services import StepReader  # noqa: E402
from shared.memory_optimizer import AdvancedCADMemoryOptimizer  # noqa: E402
from machining.machining_feature_recognizer import MachiningFeatureRecognizer  # noqa: E402

STEP_SUFFIXES = {".stp", ".step"}


def measure(path: Path, optimizer: AdvancedCADMemoryOptimizer) -> dict:
    shape = StepReader().read(str(path))
    result = optimizer.analyze_and_optimize(shape=shape, file_path=str(path), force_reanalysis=True)
    mfg = result.geometry_features.manufacturing_features.get("manufacturing_intelligence", {})
    family = mfg.get("detected_family", "")
    row = {"file": path.name, "family": family}
    if family not in MACHINING_FAMILIES:
        return row
    tree = MachiningFeatureRecognizer().recognize(shape, family)
    cov = tree.coverage
    row.update({
        "features": len(tree.features),
        "feature_types": dict(Counter(f"{f.type}:{f.variant}" for f in tree.features)),
        "face_count": cov.get("face_count"),
        "claimed_face_count": cov.get("claimed_face_count"),
        "claimed_area_fraction": cov.get("claimed_area_fraction"),
        "discrete_face_count": cov.get("discrete_face_count"),
        "discrete_area_fraction": cov.get("discrete_area_fraction"),
        "multiply_claimed": len(cov.get("multiply_claimed_faces", [])),
        "unclaimed_by_surface": dict(Counter(f["surface_type"] for f in cov.get("unclaimed_faces", []))),
        "unclaimed_area_by_surface": {
            k: round(sum(f["area_mm2"] for f in cov.get("unclaimed_faces", []) if f["surface_type"] == k), 1)
            for k in {f["surface_type"] for f in cov.get("unclaimed_faces", [])}
        },
        "warnings": tree.warnings,
    })
    return row


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("folder")
    ap.add_argument("--json")
    ap.add_argument("--per-file-timeout", type=int, default=180)
    args = ap.parse_args()

    files = sorted(p for p in Path(args.folder).iterdir() if p.suffix.lower() in STEP_SUFFIXES)
    optimizer = AdvancedCADMemoryOptimizer(cache_dir=tempfile.mkdtemp(), max_memory_mb=2048)
    def _timeout(signum, frame):
        raise TimeoutError(f"exceeded {args.per_file_timeout}s")
    signal.signal(signal.SIGALRM, _timeout)

    rows = []
    for p in files:
        t0 = time.time()
        signal.alarm(args.per_file_timeout)
        try:
            r = measure(p, optimizer)
        except Exception as exc:  # report and continue: one bad file must not hide the rest
            r = {"file": p.name, "error": str(exc)}
        finally:
            signal.alarm(0)
        r["seconds"] = round(time.time() - t0, 1)
        rows.append(r)
        if "error" in r:
            print(f"ERROR  {r['file']}: {r['error']}", flush=True)
        elif "face_count" not in r:
            print(f"skip   {r['file']} ({r['family'] or 'no family'}) {r['seconds']}s", flush=True)
        else:
            print(
                f"{r['family']:<10} {r['file']}: faces {r['claimed_face_count']}/{r['face_count']} "
                f"area {r['claimed_area_fraction']} discrete {r['discrete_face_count']}f/{r['discrete_area_fraction']}a double-claimed {r['multiply_claimed']} "
                f"unclaimed {r['unclaimed_by_surface']} {r['seconds']}s",
                flush=True,
            )
        if args.json:
            Path(args.json).write_text(json.dumps(rows, indent=2))

    machined = [r for r in rows if "face_count" in r]
    if machined:
        tot = sum(r["face_count"] for r in machined)
        cl = sum(r["claimed_face_count"] for r in machined)
        agg = Counter()
        for r in machined:
            agg.update(r["unclaimed_by_surface"])
        print(f"\nTOTAL machined parts {len(machined)}: faces claimed {cl}/{tot} ({cl / tot:.1%})")
        print(f"unclaimed faces by surface type: {dict(agg.most_common())}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
