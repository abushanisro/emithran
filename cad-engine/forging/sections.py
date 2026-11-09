"""
Cross-section curve A(x): the area of the part's section by a plane normal to an axis, at equally spaced stations.

Method: every mesh triangle of the (shared, orientation-correct) tessellation is cut by the plane; each cut is an oriented
segment with the material on its left (direction = axis x triangle normal). The section area is the shoelace sum of all those
oriented segments, so an inner boundary (a bore) comes out with the opposite orientation and subtracts by itself: no polygon
nesting, no topology, no tolerance beyond the mesh. A vertex exactly on a plane counts as above it, consistently, so loops
stay closed at a station that coincides with a face.

The curve is accurate to the tessellation: a circular section of radius R is under-measured by about (pi/n)^2 / 3 of its
area for n facets round it. The payload carries volume_check_ratio = (sum of A * spacing) / exact volume, an independent
consistency check on the whole curve.
"""
from __future__ import annotations

import bisect
import math
from typing import Any, Dict, List, Optional, Sequence, Tuple

from shared.casting_geometry import _cross, _dot, _face_triangles, _faces, _sub

from .constants import CANONICAL_AXES, DEFAULT_SECTION_STATIONS


def _triangles(shape: Any) -> List[Tuple[Tuple[float, float, float], ...]]:
    tris: List[Tuple[Tuple[float, float, float], ...]] = []
    for f in _faces(shape):
        tris.extend(_face_triangles(f))
    return tris


def world_axis_extents(tris: Sequence[Tuple[Tuple[float, float, float], ...]]) -> Dict[str, Tuple[float, float]]:
    out: Dict[str, Tuple[float, float]] = {}
    for i, name in enumerate(("x", "y", "z")):
        vals = [p[i] for t in tris for p in t]
        out[name] = (min(vals), max(vals))
    return out


def section_curve(
    shape: Any,
    axis: str = "auto",
    stations: int = DEFAULT_SECTION_STATIONS,
    exact_volume_mm3: Optional[float] = None,
) -> Dict[str, Any]:
    tris = _triangles(shape)
    if not tris:
        return {"axis": None, "stations": 0, "reason": "no tessellation"}
    extents = world_axis_extents(tris)
    if axis == "auto":
        axis = max(extents, key=lambda k: extents[k][1] - extents[k][0])
    if axis not in CANONICAL_AXES:
        raise ValueError(f"section axis must be x, y, z or auto, got {axis!r}")
    a = CANONICAL_AXES[axis]
    ai = "xyz".index(axis)
    lo, hi = extents[axis]
    length = hi - lo
    n = max(2, int(stations))
    step = length / n
    # mid-cell stations: the end faces are not sampled, and each A is the mean section of its own cell for a prism
    xs = [lo + (i + 0.5) * step for i in range(n)]
    areas = [0.0] * n

    # in-plane basis (u, v) with u x v = a, so a CCW loop about +a has positive area
    u_i, v_i = (ai + 1) % 3, (ai + 2) % 3

    for t in tris:
        zs = [p[ai] for p in t]
        tmin, tmax = min(zs), max(zs)
        if tmax - tmin < 1e-12:
            continue  # a face lying in a station plane is a step, handled by the neighbouring triangles
        first = bisect.bisect_left(xs, tmin)
        last = bisect.bisect_right(xs, tmax)
        if first >= last:
            continue
        nrm = _cross(_sub(t[1], t[0]), _sub(t[2], t[0]))
        flow = _cross(a, nrm)  # cut direction: material on the left
        for k in range(first, last):
            x = xs[k]
            above = [p[ai] >= x for p in t]
            if all(above) or not any(above):
                continue
            pts = []
            for i in range(3):
                j = (i + 1) % 3
                if above[i] != above[j]:
                    s = (x - t[i][ai]) / (t[j][ai] - t[i][ai])
                    pts.append(tuple(t[i][c] + s * (t[j][c] - t[i][c]) for c in range(3)))
            if len(pts) != 2:
                continue
            p, q = pts
            if _dot(_sub(q, p), flow) < 0:
                p, q = q, p
            areas[k] += 0.5 * (p[u_i] * q[v_i] - q[u_i] * p[v_i])

    radii = [math.sqrt(max(A, 0.0) / math.pi) for A in areas]
    mean_r = sum(radii) / n
    std_r = math.sqrt(sum((r - mean_r) ** 2 for r in radii) / n)
    integral = sum(areas) * step
    out: Dict[str, Any] = {
        "axis": axis,
        "direction": list(a),
        "origin_mm": round(lo, 4),
        "length_mm": round(length, 4),
        "stations": n,
        "station_spacing_mm": round(step, 5),
        "x_mm": [round(x - lo, 4) for x in xs],
        "area_mm2": [round(A, 4) for A in areas],
        "max_area_mm2": round(max(areas), 4),
        "max_area_x_mm": round(xs[areas.index(max(areas))] - lo, 4),
        "equivalent_radius": {
            "definition": "r(x) = sqrt(A(x) / pi); coefficient of variation = standard deviation / mean over the stations",
            "mean_mm": round(mean_r, 4),
            "std_mm": round(std_r, 4),
            "coefficient_of_variation": round(std_r / mean_r, 6) if mean_r > 0 else None,
        },
        "integrated_volume_mm3": round(integral, 3),
    }
    if exact_volume_mm3:
        out["volume_check_ratio"] = round(integral / exact_volume_mm3, 5)
    return out
