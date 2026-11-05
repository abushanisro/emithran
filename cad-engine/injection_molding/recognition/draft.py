"""
Draft and undercut on every face of the part, whatever its surface type, against a given pull direction.

draft angle of a wall triangle = asin(|dot(normal, pull)|): 0 deg for a wall parallel to the pull, 90 deg for a face square to it. Faces whose
normal is within 15 deg of the pull (|dot| > cos 75 deg) are floors, lids and parting faces, which need no draft and are left out, unless they are
covered. A triangle is undercut when it is covered from the side it faces (pull_direction.undercut_flags), whatever its angle. The face's class is the class holding most of its wall area, so a
free-form face is classified like a flat one.
"""
from __future__ import annotations

import math
from typing import Any, Dict, List, Sequence

from .mesh import FaceMesh
from .pull_direction import undercut_flags
from .vec import Vec, unit

WALL_COS_THRESHOLD = math.cos(math.radians(75.0))
# Worst class first: a tie goes to the class that costs more.
CLASS_ORDER = ("undercut", "undrafted", "drafted", "overdrafted")


def analyze_draft(meshes: Sequence[FaceMesh], pull: Vec, undrafted_deg: float, max_draft_deg: float) -> Dict[str, Any]:
    pull = unit(pull)
    flags = undercut_flags(meshes, pull, undrafted_deg)
    faces: List[Dict[str, Any]] = []
    totals = {c: 0.0 for c in CLASS_ORDER}
    counts = {c: 0 for c in CLASS_ORDER}
    draft_area = 0.0
    draft_sum = 0.0
    for f in meshes:
        area_by_class = {c: 0.0 for c in CLASS_ORDER}
        face_draft_sum = 0.0
        face_draft_area = 0.0
        for t, covered in zip(f.triangles, flags[f.index]):
            dot = abs(t.normal[0] * pull[0] + t.normal[1] * pull[1] + t.normal[2] * pull[2])
            # A floor, lid or parting face needs no draft and is skipped, unless it is covered: the underside of an overhang is an undercut however
            # square to the pull it is.
            if dot > WALL_COS_THRESHOLD and not covered:
                continue
            deg = math.degrees(math.asin(min(1.0, dot)))
            if covered:
                cls = "undercut"
            elif deg < undrafted_deg:
                cls = "undrafted"
            elif deg <= max_draft_deg:
                cls = "drafted"
            else:
                cls = "overdrafted"
            area_by_class[cls] += t.area
            if not covered:
                face_draft_sum += deg * t.area
                face_draft_area += t.area
        wall_area = sum(area_by_class.values())
        if wall_area <= 0.0:
            continue
        cls = max(CLASS_ORDER, key=lambda c: (area_by_class[c], -CLASS_ORDER.index(c)))
        counts[cls] += 1
        for c in CLASS_ORDER:
            totals[c] += area_by_class[c]
        draft_sum += face_draft_sum
        draft_area += face_draft_area
        faces.append({
            "face_id": f.index, "surface": f.surface, "class": cls, "wall_area_mm2": round(wall_area, 3),
            "avg_draft_deg": round(face_draft_sum / face_draft_area, 2) if face_draft_area > 0 else None,
            "undercut_fraction": round(area_by_class["undercut"] / wall_area, 3),
        })
    wall_total = sum(totals.values())
    # Area fractions, not face counts: a free-form cover is hundreds of faces, and a face count says little about how much of the part is affected.
    raw = (totals["undercut"] + 0.5 * totals["undrafted"]) / wall_total if wall_total > 0 else None
    return {
        "analysed_faces": len(faces),
        "wall_area_mm2": round(wall_total, 2),
        "area_by_class_mm2": {c: round(v, 2) for c, v in totals.items()},
        "faces_by_class": counts,
        "avg_draft_angle_deg": round(draft_sum / draft_area, 2) if draft_area > 0 else None,
        "parting_complexity": round(min(0.95, raw), 3) if raw is not None else None,
        "faces": faces,
    }
