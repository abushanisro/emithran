"""
The plastic feature graph: the recognised features of a part in the shape the backend resolves operations from (the same shape sheet metal's
feature_graph_v2 uses: id, feature_type, variant, attributes, occurrences with face ids). Every feature_type is checked against the plastic_molding
vocabulary generated from the catalog (shared/feature_vocabulary.py), so the engine cannot emit a type the catalog does not have.

Recognised today: SimpleHole, MultiStepHole, PlanarFace, CurvedWall, CurvedSurface, and Rib from the legacy antiparallel-wall detector (labelled as such,
it is the old planar-only rule). NOT yet recognised, and listed in `not_yet_recognized` so nothing is read as "none found": Void, ComboVoid, SharpEdge,
PartingLine, LifterBundle, SlideBundle. Their definitions in the staged variables (void accessible direction, bundling pitch and overlap, flat versus
non-flat parting line) need the aPriori rules confirmed before they are implemented, because a wrong definition changes tooling cost.
"""
from __future__ import annotations

from typing import Any, Callable, Dict, List, Sequence

SCHEMA = "plastic_feature_graph_v1"
RECOGNIZED = frozenset({"SimpleHole", "MultiStepHole", "PlanarFace", "CurvedWall", "CurvedSurface", "Rib"})


def build_feature_graph(
    holes: Dict[str, Any],
    face_features: Dict[str, Dict[str, Any]],
    rib_groups: Sequence[Dict[str, Any]],
    rib_confidence: float,
    vocabulary: Callable[[str], str],
    all_types: Sequence[str],
) -> Dict[str, Any]:
    """`vocabulary(t)` returns t when it is a catalog feature type and raises when it is not (shared.feature_vocabulary.require_feature_type)."""
    items: List[Dict[str, Any]] = []
    for h in holes.get("holes", []):
        items.append({
            "id": h["id"], "feature_type": vocabulary(h["feature_type"]), "variant": h["variant"], "diameter_mm": h["diameter_mm"], "depth_mm": h["depth_mm"],
            "attributes": {"depth_to_diameter": h["depth_to_diameter"], "angle_to_pull_deg": h["angle_to_pull_deg"], "axis": h["axis"], "steps": h["steps"]},
            "occurrences": [{"face_ids": h["face_ids"]}],
        })
    for kind, data in face_features.items():
        if kind == "unclassified" or data["faces"] == 0:
            continue
        items.append({
            "id": f"{kind.lower()}-all", "feature_type": vocabulary(kind), "variant": None, "diameter_mm": None, "depth_mm": None,
            "attributes": {"faces": data["faces"], "area_mm2": data["area_mm2"]}, "occurrences": [{"face_ids": data["face_ids"]}],
        })
    for g in rib_groups:
        items.append({
            "id": f"rib-t{g['thickness_mm']}", "feature_type": vocabulary("Rib"), "variant": "legacy_antiparallel_pairs", "diameter_mm": None, "depth_mm": None,
            "attributes": {"thickness_mm": g["thickness_mm"], "count": g["count"], "confidence": rib_confidence}, "occurrences": [],
        })
    unclassified = face_features.get("unclassified", {}).get("faces", 0)
    return {
        "schema": SCHEMA,
        "items": items,
        "not_yet_recognized": sorted(set(all_types) - RECOGNIZED),
        "unclassified_faces": unclassified,
    }
