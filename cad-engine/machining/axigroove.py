"""
AxiGroove recognition — gear teeth, splines and other axial tooth forms
repeated around a turned part's axis (the reference catalog's feature for
Hobbing, Profile Gear Grinding, Spline Rolling and Internal Gear Broaching:
"Hob Machine:Setup:Hobbing//AxiGroove", ...).

Evidence, all from the B-Rep:
  * offset_profile faces (shared/machining_geometry.collect_cylinders):
    convex cylindrical faces parallel to the part axis but off it — tooth
    flanks and tip/root rounds, which a lathe cannot produce;
  * N-fold rotational symmetry of those faces about the part axis: every
    face has a twin of the same radius and axis distance one pitch (360°/N)
    further round. N ≥ 3 is the tooth count.

Reported geometry:
  * tooth_count      — the symmetry order N;
  * tip_diameter_mm  — twice the largest distance from the axis reached on
                       any tooth face, sampled over each face's own trimmed
                       UV domain;
  * root_diameter_mm — twice the smallest distance from the axis line to any
                       tooth face (BRepExtrema_DistShapeShape);
  * face_width_mm    — the longest tooth face along the axis.
No module or pressure angle is inferred: those need the tooth form, which a
cylindrical-arc approximation of an involute does not carry.
"""
from __future__ import annotations

import math
from functools import reduce
from typing import Dict, List, Optional, Tuple

# Two tooth faces are the same size and place when their radius and axis
# distance agree to this; far above STEP precision, far below a tooth.
_SIZE_TOLERANCE_MM = 0.01


def _angle_close(a: float, b: float, tol: float) -> bool:
    d = abs((a - b + 180.0) % 360.0 - 180.0)
    return d <= tol


def _is_invariant(angles: List[float], order: int) -> bool:
    pitch = 360.0 / order
    tol = min(0.5, pitch / 10.0)
    return all(any(_angle_close(a + pitch, b, tol) for b in angles) for a in angles)


def _divisors_desc(n: int) -> List[int]:
    return sorted({d for i in range(1, int(math.isqrt(n)) + 1) if n % i == 0 for d in (i, n // i)}, reverse=True)


def _part_axis(shape, main_axis: Tuple[float, float, float]):
    """The part's own axis: through its centre of mass (a rotationally
    symmetric toothed part has its centre of mass on the axis), along
    main_axis. Returns (centre, unit axis, e1, e2) with e1/e2 spanning the
    plane normal to the axis, for measuring angles round it."""
    from OCC.Core.BRepGProp import brepgprop
    from OCC.Core.GProp import GProp_GProps

    props = GProp_GProps()
    brepgprop.VolumeProperties(shape, props)
    cm = props.CentreOfMass()
    centre = (cm.X(), cm.Y(), cm.Z())
    ax, ay, az = main_axis
    n = math.sqrt(ax * ax + ay * ay + az * az) or 1.0
    axis = (ax / n, ay / n, az / n)
    ref = (1.0, 0.0, 0.0) if abs(axis[0]) < 0.9 else (0.0, 1.0, 0.0)
    e1 = _norm(_cross(axis, ref))
    e2 = _cross(axis, e1)
    return centre, axis, e1, e2


def _cross(a, b):
    return (a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0])


def _norm(v):
    n = math.sqrt(sum(x * x for x in v)) or 1.0
    return (v[0] / n, v[1] / n, v[2] / n)


def _polar(point, centre, axis, e1, e2) -> Tuple[float, float]:
    """(distance from the axis, angle round it in degrees) of a point."""
    v = (point[0] - centre[0], point[1] - centre[1], point[2] - centre[2])
    x = sum(v[i] * e1[i] for i in range(3))
    y = sum(v[i] * e2[i] for i in range(3))
    return math.hypot(x, y), math.degrees(math.atan2(y, x)) % 360.0


def detect_axigroove(
    shape,
    offset_cylinders: List[Dict],
    main_axis: Tuple[float, float, float],
) -> Optional[Dict]:
    """Returns {"params": {...}, "face_ids": [...]} for a recognised tooth form, else None."""
    if len(offset_cylinders) < 3:
        return None

    frame = _part_axis(shape, main_axis)
    # Each face's cylinder axis is parallel to the part axis, so any point on
    # it (collect_cylinders' "centroid" is the cylinder's axis location) gives
    # the face's true offset and angle about the part's own axis.
    clusters: Dict[Tuple[int, int], List[float]] = {}
    for c in offset_cylinders:
        dist, angle = _polar(c["centroid"], *frame)
        key = (round(c["radius"] / _SIZE_TOLERANCE_MM), round(dist / _SIZE_TOLERANCE_MM))
        clusters.setdefault(key, []).append(angle)

    sizes = [len(v) for v in clusters.values()]
    common = reduce(math.gcd, sizes)
    order = next(
        (n for n in _divisors_desc(common)
         if n >= 3 and all(_is_invariant(angles, n) for angles in clusters.values())),
        None,
    )
    if order is None:
        return None

    face_ids = sorted({i for c in offset_cylinders for i in c.get("face_indices", [])})
    root_radius, tip_radius = _radial_extent(shape, face_ids, frame)
    if tip_radius is None:
        return None

    params = {
        "tooth_count": order,
        "tip_diameter_mm": round(2 * tip_radius, 3),
        "face_width_mm": round(max(c["length"] for c in offset_cylinders), 3),
    }
    if root_radius is not None:
        params["root_diameter_mm"] = round(2 * root_radius, 3)
    return {"params": params, "face_ids": face_ids}


def _radial_extent(shape, face_ids: List[int], frame) -> Tuple[Optional[float], Optional[float]]:
    """(min, max) distance from the part axis to the given faces. min is exact
    (BRepExtrema_DistShapeShape to the axis line); max is sampled over each
    face's trimmed UV bounds (BRepTools.UVBounds)."""
    from OCC.Core.BRepAdaptor import BRepAdaptor_Surface
    from OCC.Core.BRepBuilderAPI import BRepBuilderAPI_MakeEdge
    from OCC.Core.BRepExtrema import BRepExtrema_DistShapeShape
    from OCC.Core.BRepTools import breptools
    from OCC.Core.TopAbs import TopAbs_FACE
    from OCC.Core.TopExp import TopExp_Explorer
    from OCC.Core.TopoDS import topods
    from OCC.Core.gp import gp_Pnt

    centre, axis, e1, e2 = frame
    reach = 1e4
    axis_edge = BRepBuilderAPI_MakeEdge(
        gp_Pnt(*(centre[i] - axis[i] * reach for i in range(3))),
        gp_Pnt(*(centre[i] + axis[i] * reach for i in range(3))),
    ).Edge()

    wanted = set(face_ids)
    lo: Optional[float] = None
    hi: Optional[float] = None
    samples = 12
    idx = 0
    exp = TopExp_Explorer(shape, TopAbs_FACE)
    while exp.More():
        if idx in wanted:
            face = topods.Face(exp.Current())
            dist = BRepExtrema_DistShapeShape(axis_edge, face)
            if dist.IsDone():
                lo = dist.Value() if lo is None else min(lo, dist.Value())
            umin, umax, vmin, vmax = breptools.UVBounds(face)
            surf = BRepAdaptor_Surface(face)
            for i in range(samples + 1):
                u = umin + (umax - umin) * i / samples
                for j in range(samples + 1):
                    v = vmin + (vmax - vmin) * j / samples
                    pt = surf.Value(u, v)
                    r, _ = _polar((pt.X(), pt.Y(), pt.Z()), centre, axis, e1, e2)
                    hi = r if hi is None else max(hi, r)
        idx += 1
        exp.Next()
    return lo, hi
