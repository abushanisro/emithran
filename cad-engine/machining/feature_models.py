"""
Machining feature data model — extracted from machining_feature_recognizer.py
(2026-09-19), renamed from cnc_feature_recognizer.py (2026-09-19, this same
refactor) per the "Machining is the canonical domain, not CNC" architecture
mandate: canonical feature TYPES/SHAPES live here, separate from the
geometry-detection orchestration that produces them
(machining_feature_recognizer.py) and the surface-classification detectors
(face_classification.py).

CNC remains only where it is a genuine, existing manufacturing/process
classification (the real "cnc_turned"/"mill_turn"/"cnc_milled" family
strings consumed throughout the backend's DB-driven costing/taxonomy code,
and the real wire-format key "cnc_features" the backend already reads in
~15 places) -- neither is part of this refactor; both are left exactly as
they already are. The GEOMETRY-LAYER data model itself is Machining-named.

Canonical names: MachiningFeatureType, MachiningFeature, MachiningFeatureTree.
FeatureType/CNCFeature/CNCFeatureTree remain as deprecated aliases (see
bottom of file) for any caller not yet migrated -- no duplicate
implementation, just a name binding to the same real class/type.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Dict, List, Literal

# ── Feature type registry ─────────────────────────────────────────────────────

MachiningFeatureType = Literal[
    "external_diameter",  # outer cylindrical step along rotation axis
    "through_hole",       # cylindrical bore traversing full part thickness
    "blind_hole",         # cylindrical bore with closed bottom
    "tapped_hole",        # blind hole whose diameter matches a tap drill size (geometry heuristic)
    "cross_hole",         # single hole perpendicular to main axis (not in PCD)
    "pcd_hole_pattern",   # group of cross holes at equal radius + equal angular spacing
    "chamfer",            # conical face (entry/exit taper)
    "countersink",        # cone + coaxial hole (tapered entry leading to a bore)
    "counterbore",        # two coaxial cylinders: large shallow + small deep
    "groove",             # narrow toroidal face (concave annular groove)
    "fillet",             # toroidal face (convex radius blend)
    "slot",               # elongated pocket terminating in arcs (end-mill path)
    "radial_slot",        # slot oriented radially on a turned OD
    "keyway",             # axial slot on OD for key/spline engagement
    "pocket",             # enclosed prismatic recess (all walls perpendicular or angled)
    "planar_face",        # milled flat face region not already claimed by a discrete detector
    "curved_wall",        # milled cylindrical/conical/toroidal wall region (e.g. a boss), not a hole/fillet/chamfer
    "curved_surface",     # milled freeform (B-spline/Bezier) surface region
    "multi_step_hole",    # 3+ coaxial bores of strictly decreasing diameter (step drilling)
    "cutout",             # non-circular opening that goes fully through the part: a closed ring of planar walls
]


# ── Data structures ───────────────────────────────────────────────────────────


@dataclass
class MachiningFeature:
    id: str
    type: MachiningFeatureType
    params: Dict           # geometry params — type-specific (see each builder method)
    confidence: float      # 0.0–1.0
    children: List[str] = field(default_factory=list)  # child feature IDs
    face_ids: List[int] = field(default_factory=list)  # OCC face ordinals → STL triangle lookup via face_map


@dataclass
class MachiningFeatureTree:
    family: str            # "cnc_turned" | "mill_turn" | "cnc_milled" — real process-family classification, unchanged by this refactor
    features: List[MachiningFeature]
    extraction_version: str = "1.0"
    warnings: List[str] = field(default_factory=list)
    debug: Dict = field(default_factory=dict)  # face counts + recognizer used

    def to_dict(self) -> dict:
        by_type: Dict[str, int] = {}
        for f in self.features:
            by_type[f.type] = by_type.get(f.type, 0) + 1
        return {
            "family": self.family,
            "features": [
                {
                    "id": f.id,
                    "type": f.type,
                    "params": f.params,
                    "confidence": round(f.confidence, 3),
                    "children": f.children,
                    "face_ids": f.face_ids,
                }
                for f in self.features
            ],
            "feature_summary": by_type,
            "extraction_version": self.extraction_version,
            "warnings": self.warnings,
            "debug": self.debug,
        }


# ── Deprecated backward-compatibility aliases ────────────────────────────────
# Real name bindings, not duplicate implementations. Kept only so any
# not-yet-migrated caller (internal or external) importing the old CNC-
# prefixed names keeps working. All internal production code in this
# repository has been migrated to the Machining-prefixed names above --
# do not add new uses of these aliases.

FeatureType = MachiningFeatureType
"""Deprecated alias for MachiningFeatureType. Use MachiningFeatureType."""

CNCFeature = MachiningFeature
"""Deprecated alias for MachiningFeature. Use MachiningFeature."""

CNCFeatureTree = MachiningFeatureTree
"""Deprecated alias for MachiningFeatureTree. Use MachiningFeatureTree."""
