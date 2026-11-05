"""
The plastic feature graph: the recognised features of a part in the shape the backend resolves operations from (the same shape sheet metal's
feature_graph_v2 uses: id, feature_type, variant, attributes, occurrences with face ids). Every feature_type is checked against the plastic_molding
vocabulary generated from the catalog (shared/feature_vocabulary.py), so the engine cannot emit a type the catalog does not have.

Recognised today: SimpleHole, MultiStepHole, PlanarFace, CurvedWall, CurvedSurface, and Rib from the legacy antiparallel-wall detector (labelled as such,
it is the old planar-only rule). Void, ComboVoid, LifterBundle, SlideBundle and PartingLine come from side_actions.py and parting.py: a READING of the staged variables' notes, flagged in each item's `reading`.
What is not assessed (SharpEdge; a parting line the geometry does not show) is listed in `not_yet_recognized` with the reason in `not_assessed_reasons`, so nothing is read as "none found".
"""
from __future__ import annotations

from typing import Any, Callable, Dict, List, Sequence

SCHEMA = "plastic_feature_graph_v1"
SIDE_READING = "side_action_reading_v1"
RECOGNIZED = frozenset({
    "SimpleHole", "MultiStepHole", "PlanarFace", "CurvedWall", "CurvedSurface", "Rib", "Void", "ComboVoid", "LifterBundle", "SlideBundle", "PartingLine",
})
# Why a type is still not assessed: said in the result, so absence is never read as "none found".
NOT_ASSESSED_REASONS = {
    "SharpEdge": "no staged rule defines a sharp edge (no angle or radius threshold), and its only catalog operation is As Molded, which adds no cost",
}


def build_feature_graph(
    holes: Dict[str, Any],
    face_features: Dict[str, Dict[str, Any]],
    rib_groups: Sequence[Dict[str, Any]],
    rib_confidence: float,
    vocabulary: Callable[[str], str],
    all_types: Sequence[str],
    side_actions: Dict[str, Any] | None = None,
    parting: Dict[str, Any] | None = None,
    centroid_of: Callable[[Sequence[int]], List[float]] | None = None,
) -> Dict[str, Any]:
    """`vocabulary(t)` returns t when it is a catalog feature type and raises when it is not (shared.feature_vocabulary.require_feature_type)."""
    items: List[Dict[str, Any]] = []

    def occ(face_ids: Sequence[int]) -> Dict[str, Any]:
        """One occurrence: its faces and, for the 3D viewer, where they are (part-centered coordinates, as in the other feature graphs)."""
        return {"face_ids": list(face_ids), **({"centroid": centroid_of(face_ids)} if centroid_of else {})}

    consumed = set((side_actions or {}).get("consumed_ids", []))  # holes and voids that a ComboVoid replaces
    for h in holes.get("holes", []):
        if h["id"] in consumed:
            continue
        items.append({
            "id": h["id"], "feature_type": vocabulary(h["feature_type"]), "variant": h["variant"], "diameter_mm": h["diameter_mm"], "depth_mm": h["depth_mm"],
            "attributes": {"depth_to_diameter": h["depth_to_diameter"], "angle_to_pull_deg": h["angle_to_pull_deg"], "axis": h["axis"], "steps": h["steps"]},
            "occurrences": [occ(h["face_ids"])],
        })
    for kind, data in face_features.items():
        if kind == "unclassified" or data["faces"] == 0:
            continue
        items.append({
            "id": f"{kind.lower()}-all", "feature_type": vocabulary(kind), "variant": None, "diameter_mm": None, "depth_mm": None,
            "attributes": {"faces": data["faces"], "area_mm2": data["area_mm2"]}, "occurrences": [occ(data["face_ids"])],
        })
    for g in rib_groups:
        items.append({
            "id": f"rib-t{g['thickness_mm']}", "feature_type": vocabulary("Rib"), "variant": "legacy_antiparallel_pairs", "diameter_mm": None, "depth_mm": None,
            "attributes": {"thickness_mm": g["thickness_mm"], "count": g["count"], "confidence": rib_confidence}, "occurrences": [],
        })
    sa = side_actions or {}
    for v in sa.get("voids", []):
        if v["id"] in consumed:
            continue
        items.append({
            "id": v["id"], "feature_type": vocabulary("Void"), "variant": "side", "diameter_mm": v["equivalent_diameter_mm"], "depth_mm": v["depth_mm"],
            "attributes": {k: v[k] for k in ("area_mm2", "opening_area_mm2", "curved_area_ratio", "angle_to_pull_deg", "accessible_direction")} | {"reading": SIDE_READING},
            "occurrences": [occ(v["face_ids"])],
        })
    for c in sa.get("combo_voids", []):
        items.append({
            "id": c["id"], "feature_type": vocabulary("ComboVoid"), "variant": "side", "diameter_mm": None, "depth_mm": None,
            "attributes": {"members": c["member_ids"], "angle_to_pull_deg": c["angle_to_pull_deg"], "extent_mm": c["extent_mm"], "reading": SIDE_READING},
            "occurrences": [occ(c["face_ids"])],
        })
    for b in sa.get("bundles", []):
        items.append({
            "id": b["id"], "feature_type": vocabulary(b["feature_type"]), "variant": b["size_class"], "diameter_mm": None, "depth_mm": b["stroke_mm"],
            "attributes": {k: b[k] for k in ("count", "member_ids", "width_mm", "stroke_mm", "size_class", "direction", "slide_alternative", "worst_from_square_deg",
                                              "exceeds_max_action_length", "exceeds_max_stroke")} | {"reading": SIDE_READING},
            "occurrences": [occ(b["face_ids"])],
        })
    if parting and parting.get("status") == "found":
        items.append({
            "id": "parting-line", "feature_type": vocabulary("PartingLine"), "variant": parting["variant"], "diameter_mm": None, "depth_mm": None,
            "attributes": {"length_mm": parting["length_mm"], "height_spread_mm": parting["height_spread_mm"], "internal_cutouts": parting.get("internal_cutouts", 0), "reading": parting["reading"]},
            "occurrences": [],
        })
    unclassified = face_features.get("unclassified", {}).get("faces", 0)
    not_assessed = sorted(set(all_types) - RECOGNIZED)
    reasons = {t: NOT_ASSESSED_REASONS.get(t, "not recognised yet") for t in not_assessed}
    if parting and parting.get("status") == "indeterminate":
        not_assessed = sorted(set(not_assessed) | {"PartingLine"})
        reasons["PartingLine"] = parting["reason"]
    return {
        "schema": SCHEMA,
        "items": items,
        "not_yet_recognized": not_assessed,
        "not_assessed_reasons": reasons,
        "unclassified_faces": unclassified,
    }
