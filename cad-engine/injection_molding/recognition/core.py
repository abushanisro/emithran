"""The recognition core: tessellate, census, pull direction, draft and undercut. Geometric facts only (see the package docstring)."""
from __future__ import annotations

import math
from typing import Any, Dict, List, Optional, Sequence

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


def _centroid_lookup(meshes: Sequence[Any]):
    """face ids -> the centre of those faces in part-centered coordinates (the mesh's own bounding-box centre is taken as the part centre)."""
    verts = [v for f in meshes for t in f.triangles for v in t.vertices]
    if not verts:
        return lambda ids: [0.0, 0.0, 0.0]
    centre = [(min(v[i] for v in verts) + max(v[i] for v in verts)) / 2.0 for i in range(3)]
    by_face = {}
    for f in meshes:
        w = sum(t.area for t in f.triangles)
        if w > 0:
            by_face[f.index] = (w, [sum(t.centroid[i] * t.area for t in f.triangles) / w for i in range(3)])

    def centroid_of(face_ids: Sequence[int]) -> List[float]:
        pts = [by_face[i] for i in face_ids if i in by_face]
        if not pts:
            return [0.0, 0.0, 0.0]
        total = sum(w for w, _ in pts)
        return [round(sum(w * c[i] for w, c in pts) / total - centre[i], 3) for i in range(3)]

    return centroid_of


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
    side["isolated_undercut_faces"] = found["isolated_undercut_faces"]
    parting = parting_line(meshes, pull.vector, undrafted_deg)
    if parting["status"] == "found":
        parting["internal_cutouts"] = sum(1 for h in holes["holes"] if h["variant"] == "through")
    centroid_of = _centroid_lookup(meshes)
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
            side_actions=side, parting=parting, centroid_of=centroid_of,
        ),
    }
