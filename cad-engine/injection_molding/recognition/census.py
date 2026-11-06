"""What a part is made of: face and area counts per surface type, over every face (the old analysis looked at planar faces only)."""
from __future__ import annotations

from typing import Any, Dict, List

from .mesh import FaceMesh


def surface_census(meshes: List[FaceMesh]) -> Dict[str, Any]:
    by_surface: Dict[str, Dict[str, float]] = {}
    for f in meshes:
        entry = by_surface.setdefault(f.surface, {"faces": 0, "area_mm2": 0.0})
        entry["faces"] += 1
        entry["area_mm2"] += f.area
    return {
        "faces": len(meshes),
        "triangles": sum(len(f.triangles) for f in meshes),
        "unmeshed_faces": sum(1 for f in meshes if not f.triangles),
        "area_mm2": round(sum(f.area for f in meshes), 2),
        "by_surface": {k: {"faces": int(v["faces"]), "area_mm2": round(v["area_mm2"], 2)} for k, v in sorted(by_surface.items())},
    }
