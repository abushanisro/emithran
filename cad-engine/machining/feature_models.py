"""
Machining feature data model.

Every MachiningFeature.type is a canonical reference feature type -- the exact
"//Feature" vocabulary of the machining operation catalog
(memory/machining/operations_full__operations.csv, generated into
shared/reference_features.json by scripts/build_reference_features.py). It is
validated at construction, so an invented or misspelled type fails loudly.

The catalog's feature types are GEOMETRY classes; what is done to them is the
operation ("Drilling//SimpleHole", "Tapping//SimpleHole",
"Multistep Holemaking//MultiStepHole:Counterboring//SimpleHole"). Distinctions
the costing layer needs that are geometric facts about the feature -- through
vs. blind, threaded, counterbored, chamfered -- are carried in `variant`, a
closed per-type set below. The operation itself is chosen downstream by the
backend's operation resolver, never baked in here.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Dict, FrozenSet, List, Literal, Mapping

from shared.feature_vocabulary import require_feature_type

# The reference feature types this recognizer currently detects. A strict
# subset of shared/reference_features.json's machining vocabulary (validated
# at import below) -- the rest of the catalog (AxiGroove, Polygon, ComboVoid,
# RingedHole, StockTrim, ...) has no detector yet and is simply not emitted.
MachiningFeatureType = Literal[
    "SimpleHole",
    "MultiStepHole",
    "Edge",
    "Ring",
    "Slot",
    "Keyway",
    "PocketV2",
    "Cutout",
    "PlanarFace",
    "CurvedWall",
    "CurvedSurface",
    "AxiGroove",
]

# Geometric sub-classification per type. Each value is a real geometric fact
# a detector establishes, not an operation name.
VARIANTS: Mapping[str, FrozenSet[str]] = {
    # through / blind: bore spans / does not span the part along its axis.
    # threaded: diameter falls in a real tap-drill band (geometry heuristic).
    # cross: bore axis perpendicular to a turned part's rotation axis.
    # pcd_pattern: an equal-radius, equal-angle group of holes (children = members).
    "SimpleHole": frozenset({"through", "blind", "threaded", "cross", "pcd_pattern"}),
    # counterbore: 2 coaxial bores, large+shallow over small+deep.
    # stepped: 3+ coaxial bores of strictly decreasing diameter.
    "MultiStepHole": frozenset({"counterbore", "stepped"}),
    # countersink: cone coaxial with a bore; chamfer: cone with no bore;
    # round: convex toroidal blend.
    "Edge": frozenset({"countersink", "chamfer", "round"}),
    # outer_diameter: external turned cylinder step; groove: concave annular
    # (toroidal) recess on a turned part.
    "Ring": frozenset({"outer_diameter", "groove"}),
    # straight: elongated milled slot; radial: elongated slot on a turned OD;
    # groove: concave toroidal recess on a milled part (Groove Milling//Slot).
    "Slot": frozenset({"straight", "radial", "groove"}),
    "Keyway": frozenset({"default"}),
    "PocketV2": frozenset({"default"}),
    "Cutout": frozenset({"default"}),
    "PlanarFace": frozenset({"default"}),
    "CurvedWall": frozenset({"default"}),
    "CurvedSurface": frozenset({"default"}),
    # Teeth repeated around a turned part's axis (gear / spline): see axigroove.py.
    "AxiGroove": frozenset({"default"}),
}

for _t in VARIANTS:
    require_feature_type("machining", _t)


@dataclass
class MachiningFeature:
    id: str
    type: MachiningFeatureType
    params: Dict           # geometry params -- type-specific
    confidence: float      # 0.0-1.0
    variant: str = "default"
    children: List[str] = field(default_factory=list)  # child feature IDs
    face_ids: List[int] = field(default_factory=list)  # OCC face ordinals -> STL triangle lookup via face_map

    def __post_init__(self) -> None:
        require_feature_type("machining", self.type)
        allowed = VARIANTS.get(self.type)
        if allowed is None or self.variant not in allowed:
            raise ValueError(
                f"variant {self.variant!r} is not valid for {self.type} "
                f"(allowed: {sorted(allowed or [])})"
            )


@dataclass
class MachiningFeatureTree:
    family: str            # shared/part_family.py machining family: turned | mill_turn | milled
    features: List[MachiningFeature]
    extraction_version: str = "2.0"
    warnings: List[str] = field(default_factory=list)
    debug: Dict = field(default_factory=dict)  # face counts + recognizer used
    # face_coverage.account_face_coverage() result: which B-Rep faces the
    # features explain. Empty when coverage could not be computed.
    coverage: Dict = field(default_factory=dict)
    # face_classification.detect_polygon_rings() rings (kind, across flats,
    # depth). Candidates only: a drawing polygon callout makes one a polygon.
    polygon_candidates: List[Dict] = field(default_factory=list)

    def to_dict(self) -> dict:
        by_type: Dict[str, int] = {}
        by_variant: Dict[str, int] = {}
        for f in self.features:
            by_type[f.type] = by_type.get(f.type, 0) + 1
            key = f"{f.type}:{f.variant}"
            by_variant[key] = by_variant.get(key, 0) + 1
        return {
            "family": self.family,
            "features": [
                {
                    "id": f.id,
                    "type": f.type,
                    "variant": f.variant,
                    "params": f.params,
                    "confidence": round(f.confidence, 3),
                    "children": f.children,
                    "face_ids": f.face_ids,
                }
                for f in self.features
            ],
            "feature_summary": by_type,
            "variant_summary": by_variant,
            "extraction_version": self.extraction_version,
            "warnings": self.warnings,
            "debug": self.debug,
            "polygon_candidates": self.polygon_candidates,
            **({
                "face_coverage": self.coverage,
                "unclaimed_face_ids": [f["face_id"] for f in self.coverage.get("unclaimed_faces", [])],
            } if self.coverage else {}),
        }
