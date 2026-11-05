"""The recognition core: tessellate, census, pull direction, draft and undercut. Geometric facts only (see the package docstring)."""
from __future__ import annotations

import math
from typing import Any, Dict, Optional, Sequence

from .census import surface_census
from .draft import analyze_draft
from .mesh import tessellate_faces
from .pull_direction import Vec, choose_pull_direction

VERSION = "plastic_recognition_core_v1"


def recognize_core(
    shape: Any,
    bbox_dims: Sequence[float],
    undrafted_deg: float,
    max_draft_deg: float,
    pull_override: Optional[Vec] = None,
) -> Dict[str, Any]:
    """
    `undrafted_deg` and `max_draft_deg` are the caller's thresholds (the staged reference variables, once the backend sends them); this module holds none.
    `pull_override` is the engineer's own mold-opening direction, used instead of the one found.
    """
    diagonal = math.sqrt(sum(float(x) ** 2 for x in bbox_dims))
    meshes = tessellate_faces(shape, linear_deflection=max(0.1, diagonal * 0.001))
    pull = choose_pull_direction(meshes, undrafted_deg, pull_override)
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
    }
