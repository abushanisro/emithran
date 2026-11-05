"""The recognition core: tessellate, census, pull direction, draft and undercut. Geometric facts only (see the package docstring)."""
from __future__ import annotations

import math
from typing import Any, Dict, Optional, Sequence

from .census import surface_census
from .draft import analyze_draft
from .face_features import classify_faces
from .feature_graph import build_feature_graph
from .holes import recognize_holes
from .mesh import tessellate_faces
from .parting import parting_line
from .pull_direction import choose_pull_direction
from .rules import staged_rules
from .side_actions import combine_and_bundle, find_voids
from .vec import Vec
from shared.feature_vocabulary import feature_types, require_feature_type

VERSION = "plastic_recognition_core_v1"


def recognize_core(
    shape: Any,
    bbox_dims: Sequence[float],
    undrafted_deg: float,
    max_draft_deg: float,
    pull_override: Optional[Vec] = None,
    legacy_rib_groups: Sequence[Dict[str, Any]] = (),
    legacy_rib_confidence: float = 0.0,
) -> Dict[str, Any]:
    """
    `undrafted_deg` and `max_draft_deg` are the caller's thresholds (the staged reference variables, once the backend sends them); this module holds none.
    `pull_override` is the engineer's own mold-opening direction, used instead of the one found.
    """
    diagonal = math.sqrt(sum(float(x) ** 2 for x in bbox_dims))
    meshes = tessellate_faces(shape, linear_deflection=max(0.1, diagonal * 0.001))
    pull = choose_pull_direction(meshes, undrafted_deg, pull_override)
    holes = recognize_holes(meshes, pull.vector)
    hole_faces = {fid for h in holes["holes"] for fid in h["face_ids"]}
    faces = classify_faces(meshes, pull.vector, skip_face_ids=list(hole_faces))
    found = find_voids(meshes, pull.vector, hole_faces, undrafted_deg)
    side = combine_and_bundle(found["voids"], holes["holes"], meshes, pull.vector, staged_rules(), max_draft_deg)
    side["voids"] = [{k: v for k, v in x.items() if not k.startswith("_")} for x in found["voids"]]
    side["ignored_clusters"] = found["ignored_clusters"]
    parting = parting_line(meshes, pull.vector, undrafted_deg)
    if parting["status"] == "found":
        parting["internal_cutouts"] = sum(1 for h in holes["holes"] if h["variant"] == "through")
    return {
        "version": VERSION,
        "surface_census": surface_census(meshes),
        "pull_direction": {
            "vector": [round(c, 5) for c in pull.vector],
            "source": pull.source,
            "axis": pull.nearest_axis(),
            "undercut_area_mm2": round(pull.undercut_area_mm2, 2),
            "projected_area_mm2": round(pull.projected_area_mm2, 2),
            "alternatives": [
                {"vector": [round(c, 5) for c in a.direction], "undercut_area_mm2": round(a.undercut_area_mm2, 2), "projected_area_mm2": round(a.projected_area_mm2, 2)}
                for a in pull.alternatives
            ],
        },
        "draft": analyze_draft(meshes, pull.vector, undrafted_deg, max_draft_deg),
        "features": holes,
        "face_features": faces,
        "side_actions": side,
        "parting_line": parting,
        "feature_graph": build_feature_graph(
            holes, faces, legacy_rib_groups, legacy_rib_confidence, lambda t: require_feature_type("plastic_molding", t), sorted(feature_types("plastic_molding")),
            side_actions=side, parting=parting,
        ),
    }
