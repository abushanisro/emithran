"""
Every face of the part as one of the catalog's face feature types (the "As Molded" features of memory/Plastic Modeling): a flat face is a PlanarFace; a
curved face whose normal lies across the pull direction is a CurvedWall, and a curved face that faces along the pull (a floor, a lid, a free-form top)
is a CurvedSurface. Faces already carried by a hole are not counted again.

This is geometry only: orientation to the pull direction and the surface type. It needs no reference variable. The wall cut-off is the same 75 degrees
the draft analysis uses, so a face is a "wall" here exactly when the draft analysis treats it as one.
"""
from __future__ import annotations

from typing import Any, Dict, Iterable, List, Sequence

from .draft import WALL_COS_THRESHOLD
from .mesh import FaceMesh
from .vec import Vec, dot, unit

FACE_TYPES = ("PlanarFace", "CurvedWall", "CurvedSurface")


def classify_faces(meshes: Sequence[FaceMesh], pull: Vec, skip_face_ids: Iterable[int] = ()) -> Dict[str, Dict[str, Any]]:
    """Per face type: how many faces, their total area and their face ids. Faces with no mesh (area 0 or unmeshed) are listed under `unclassified`."""
    pull = unit(pull)
    skip = set(skip_face_ids)
    out: Dict[str, Dict[str, Any]] = {t: {"faces": 0, "area_mm2": 0.0, "face_ids": []} for t in FACE_TYPES}
    unclassified: List[int] = []
    for f in meshes:
        if f.index in skip:
            continue
        if not f.triangles:
            unclassified.append(f.index)
            continue
        if f.surface == "plane":
            kind = "PlanarFace"
        else:
            area = sum(t.area for t in f.triangles)
            along = sum(abs(dot(t.normal, pull)) * t.area for t in f.triangles) / area if area > 0 else 1.0
            kind = "CurvedWall" if along <= WALL_COS_THRESHOLD else "CurvedSurface"
        entry = out[kind]
        entry["faces"] += 1
        entry["area_mm2"] += f.area
        entry["face_ids"].append(f.index)
    for entry in out.values():
        entry["area_mm2"] = round(entry["area_mm2"], 2)
    out["unclassified"] = {"faces": len(unclassified), "area_mm2": 0.0, "face_ids": unclassified}
    return out
