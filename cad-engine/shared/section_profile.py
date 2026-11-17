"""
The area of a solid's cross-section at stations along an axis.

A forging starts as a length of bar, and the bar has to hold the most metal where the part does: the largest cross-section across the bar's axis
sets the bar size, and how the area changes along the axis says how far the metal must be moved (a shaft with one head is an upset; a part whose
section rises and falls needs the stock gathered first). The bounding box says none of this.

Method: the axis extent of the solid is cut into equal slabs and the solid is intersected with a plane through the middle of each slab; the area
of that intersection is exact (it is the area of B-Rep faces, not of a mesh). Because each station is the middle of its slab, the areas times the
slab length add up to the volume, to within how much the section changes inside a slab: `volume_from_profile_mm3` is reported so a caller can
compare it with the solid's own volume. A station whose intersection could not be built has no area (None) and is counted, never guessed.
"""
from __future__ import annotations

import math
from typing import Any, Dict, List, Optional, Sequence

from shared.casting_geometry import _dot, _ensure_mesh, _face_triangles, _faces

DEFAULT_STATIONS = 24


def section_area_profile(shape: Any, axis: Sequence[float], stations: int = DEFAULT_STATIONS, linear_deflection: float = 0.1) -> Dict[str, Any]:
    from OCC.Core.BRepAlgoAPI import BRepAlgoAPI_Common  # type: ignore
    from OCC.Core.BRepBuilderAPI import BRepBuilderAPI_MakeFace  # type: ignore
    from OCC.Core.BRepGProp import brepgprop  # type: ignore
    from OCC.Core.GProp import GProp_GProps  # type: ignore
    from OCC.Core.gp import gp_Dir, gp_Pln, gp_Pnt  # type: ignore

    length = math.sqrt(sum(float(x) * float(x) for x in axis))
    if length == 0:
        raise ValueError("the profile axis has zero length")
    if stations < 1:
        raise ValueError("a profile needs at least one station")
    n = tuple(float(x) / length for x in axis)

    _ensure_mesh(shape, linear_deflection)
    points = [p for face in _faces(shape) for t in _face_triangles(face) for p in t]
    if not points:
        return {"axis": [round(c, 5) for c in n], "start_mm": 0.0, "length_mm": 0.0, "station_spacing_mm": 0.0, "areas_mm2": [], "max_area_mm2": None,
                "min_area_mm2": None, "volume_from_profile_mm3": None, "failed_stations": 0}
    along = [_dot(p, n) for p in points]
    lo, hi = min(along), max(along)
    # The cutting face only has to be wider than the solid in every direction across the axis.
    reach = 2.0 * max(math.dist(p, points[0]) for p in points) + 1.0
    centre = points[0]
    slab = (hi - lo) / stations

    areas: List[Optional[float]] = []
    for i in range(stations):
        offset = lo + (i + 0.5) * slab
        shift = offset - _dot(centre, n)
        origin = gp_Pnt(centre[0] + n[0] * shift, centre[1] + n[1] * shift, centre[2] + n[2] * shift)
        cut_face = BRepBuilderAPI_MakeFace(gp_Pln(origin, gp_Dir(*n)), -reach, reach, -reach, reach).Face()
        common = BRepAlgoAPI_Common(shape, cut_face)
        if not common.IsDone():
            areas.append(None)
            continue
        props = GProp_GProps()
        brepgprop.SurfaceProperties(common.Shape(), props)
        areas.append(round(float(props.Mass()), 3))

    measured = [a for a in areas if a is not None]
    failed = len(areas) - len(measured)
    return {
        "axis": [round(c, 5) for c in n],
        "start_mm": round(lo, 3),
        "length_mm": round(hi - lo, 3),
        "station_spacing_mm": round(slab, 4),
        "areas_mm2": areas,
        "max_area_mm2": max(measured) if measured else None,
        "min_area_mm2": min(measured) if measured else None,
        "volume_from_profile_mm3": round(sum(measured) * slab, 2) if measured and failed == 0 else None,
        "failed_stations": failed,
    }
