"""
Generate the plastic recognition rules (the staged variables the side-action recognition reads) from the reference variables file.
Source of truth: memory/Plastic Modeling/variables/digital_factory_variables.csv. The engine never hard-codes these values: it reads
shared/plastic_recognition_rules.json, which this script writes (and a test compares to the source when the licensed data is present).

Run from anywhere:  python cad-engine/scripts/build_plastic_recognition_rules.py
"""
from __future__ import annotations

import csv
import json
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parents[2]
SOURCE = REPO / "memory" / "Plastic Modeling" / "variables" / "digital_factory_variables.csv"
OUT = REPO / "cad-engine" / "shared" / "plastic_recognition_rules.json"

# name -> why the engine needs it
KEYS = {
    "drawDirectionOrthogonalEpsilon": "angular difference of setup axes of features sharing a bundle (deg)",
    "drawDirectionOrthogonalEpsilonForLifters": "how far from square to the pull an axis may be and still be served by a lifter (deg)",
    "drawDirectionOrthogonalEpsilonForSlides": "the same for a slide (deg)",
    "maxGCDPitch": "bundling: pitch between holes or voids (mm)",
    "minActionGcdsDepthOverlap": "bundling: minimal axial overlap of features bundled on one action (mm)",
    "maxActionLength": "bundling: distance parallel to the parting line between start and end of a slide or lifter (mm)",
    "maxCorePullStrokeLength": "bundling: longest core pull stroke (mm)",
    "smallLifterBundleWidthThreshold": "width between a small and a medium lifter bundle (mm)",
    "mediumLifterBundleWidthThreshold": "width between a medium and a large lifter bundle (mm)",
    "smallSlideBundleWidthThreshold": "width between a small and a medium slide bundle (mm)",
    "mediumSlideBundleWidthThreshold": "width between a medium and a large slide bundle (mm)",
    "cmVoidPlanarFaceNormalParallelTolerance": "angle within which a face normal counts as parallel to the void's accessible direction (deg)",
}


def main() -> int:
    rows = {r["variableName"]: r for r in csv.DictReader(SOURCE.open(newline="", encoding="utf-8"))}
    out = {}
    for key, why in KEYS.items():
        if key not in rows:
            print(f"missing variable {key} in {SOURCE}", file=sys.stderr)
            return 1
        out[key] = {"value": float(rows[key]["stringValue"]), "meaning": why}
    OUT.write_text(json.dumps({"source": "memory/Plastic Modeling/variables/digital_factory_variables.csv", "rules": out}, indent=2) + "\n")
    print(f"wrote {OUT} ({len(out)} rules)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
