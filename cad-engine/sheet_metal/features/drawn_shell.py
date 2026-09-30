"""
Drawn-shell recognition: a sheet part formed by drawing (deep draw / fluid
cell hydroforming), as opposed to one folded on a press brake.

The positive signal is topological and exact. Drawing stretches the sheet over
a punch, so the part carries DOUBLE-curved shell faces -- the torus of a cup's
bottom radius, the sphere patch of a drawn box's corner -- each with an offset
twin exactly one sheet thickness away (coaxial tori whose minor radii differ by
t; concentric spheres whose radii differ by t). Folding never makes one: a
press-brake bend is a single-curved cylinder. One such twin pair is the
recognition.

The drawn region is then the connected network of curved faces (cylinders,
cones, tori, spheres) that contains a twin pair: the cup wall, its bottom and
flange radii, a box's corner and bottom radii. Those faces are not bends,
holes or rolled forms, and the extractor removes them from those detectors.

Measured, never assumed:
  draw axis          the base panel normal the extractor already computed
  depth_mm           the part's extent along that axis
  opening_width_mm   the drawn region's minimum width across the axis
                     (rotating calipers on its projected outline)
  developed_area_mm2 half the area of every face that has an offset twin
                     (inner + outer skin of the sheet), the blank's area by
                     constant-volume drawing

depth_to_width is reported for routing (the hydroforming variable
fluidCellFormingRatioThreshold separates Fluid Cell from Deep Draw); this
module does not route.
"""
from __future__ import annotations

import math
from typing import Any, Dict, List, Optional, Sequence, Tuple

Vec = Tuple[float, float, float]

_ANG_TOL = 1e-3
_POS_TOL = 0.05


def _unit(v: Vec) -> Vec:
    m = math.sqrt(v[0] ** 2 + v[1] ** 2 + v[2] ** 2) or 1.0
    return (v[0] / m, v[1] / m, v[2] / m)


def _dot(a: Vec, b: Vec) -> float:
    return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]


def _sub(a: Vec, b: Vec) -> Vec:
    return (a[0] - b[0], a[1] - b[1], a[2] - b[2])


def _cross(a: Vec, b: Vec) -> Vec:
    return (a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0])


def _same_axis(d1: Vec, p1: Vec, d2: Vec, p2: Vec) -> bool:
    """Two lines coincide: parallel directions and p2 on line 1."""
    if abs(abs(_dot(d1, d2)) - 1.0) > _ANG_TOL:
        return False
    off = _sub(p2, p1)
    perp = _cross(off, d1)
    return math.sqrt(_dot(perp, perp)) < _POS_TOL


def _thickness_match(a: float, b: float, t: float) -> bool:
    return abs(abs(a - b) - t) <= max(0.1 * t, 0.02)


def _face_records(shape: Any) -> List[Dict[str, Any]]:
    """Every face with its index (TopExp_Explorer order, the face_ids
    convention of the whole extractor), surface type and parameters."""
    from OCC.Core.TopExp import TopExp_Explorer  # type: ignore
    from OCC.Core.TopAbs import TopAbs_FACE  # type: ignore
    from OCC.Core.TopoDS import topods  # type: ignore
    from OCC.Core.BRepAdaptor import BRepAdaptor_Surface  # type: ignore
    from OCC.Core.GeomAbs import GeomAbs_Plane, GeomAbs_Cylinder, GeomAbs_Cone, GeomAbs_Sphere, GeomAbs_Torus  # type: ignore
    from OCC.Core.GProp import GProp_GProps  # type: ignore
    from OCC.Core.BRepGProp import brepgprop  # type: ignore

    def vec(d) -> Vec:
        return (float(d.X()), float(d.Y()), float(d.Z()))

    records: List[Dict[str, Any]] = []
    exp = TopExp_Explorer(shape, TopAbs_FACE)
    idx = 0
    while exp.More():
        face = topods.Face(exp.Current())
        s = BRepAdaptor_Surface(face)
        props = GProp_GProps()
        brepgprop.SurfaceProperties(face, props)
        rec: Dict[str, Any] = {"index": idx, "face": face, "adaptor": s, "area": props.Mass(), "kind": "other"}
        t = s.GetType()
        if t == GeomAbs_Plane:
            ax = s.Plane().Axis()
            rec.update(kind="plane", dir=_unit(vec(ax.Direction())), point=vec(ax.Location()))
        elif t == GeomAbs_Cylinder:
            c = s.Cylinder()
            rec.update(kind="cylinder", dir=_unit(vec(c.Axis().Direction())), point=vec(c.Axis().Location()), radius=c.Radius())
        elif t == GeomAbs_Cone:
            c = s.Cone()
            rec.update(kind="cone", dir=_unit(vec(c.Axis().Direction())), point=vec(c.Axis().Location()), radius=c.RefRadius())
        elif t == GeomAbs_Torus:
            c = s.Torus()
            rec.update(kind="torus", dir=_unit(vec(c.Axis().Direction())), point=vec(c.Axis().Location()),
                       major=c.MajorRadius(), minor=c.MinorRadius())
        elif t == GeomAbs_Sphere:
            c = s.Sphere()
            rec.update(kind="sphere", point=vec(c.Location()), radius=c.Radius())
        records.append(rec)
        idx += 1
        exp.Next()
    return records


def _twins(a: Dict[str, Any], b: Dict[str, Any], t: float) -> bool:
    """a and b are the two skins of the same sheet region, one thickness apart."""
    if a["kind"] != b["kind"]:
        return False
    k = a["kind"]
    if k == "plane":
        if abs(abs(_dot(a["dir"], b["dir"])) - 1.0) > _ANG_TOL:
            return False
        return abs(abs(_dot(_sub(b["point"], a["point"]), a["dir"])) - t) <= max(0.1 * t, 0.02)
    if k in ("cylinder", "cone"):
        return _same_axis(a["dir"], a["point"], b["dir"], b["point"]) and _thickness_match(a["radius"], b["radius"], t)
    if k == "torus":
        return (_same_axis(a["dir"], a["point"], b["dir"], b["point"])
                and abs(a["major"] - b["major"]) <= _POS_TOL
                and _thickness_match(a["minor"], b["minor"], t))
    if k == "sphere":
        d = _sub(a["point"], b["point"])
        return math.sqrt(_dot(d, d)) <= _POS_TOL and _thickness_match(a["radius"], b["radius"], t)
    return False


def _sample_points(rec: Dict[str, Any], n: int = 6) -> List[Vec]:
    s = rec["adaptor"]
    u0, u1, v0, v1 = s.FirstUParameter(), s.LastUParameter(), s.FirstVParameter(), s.LastVParameter()
    pts: List[Vec] = []
    for i in range(n + 1):
        for j in range(n + 1):
            p = s.Value(u0 + (u1 - u0) * i / n, v0 + (v1 - v0) * j / n)
            pts.append((p.X(), p.Y(), p.Z()))
    return pts


def _min_width_2d(points: List[Tuple[float, float]]) -> float:
    """Minimum caliper width of a 2D point set (convex hull, rotating calipers)."""
    pts = sorted(set((round(x, 4), round(y, 4)) for x, y in points))
    if len(pts) < 3:
        return 0.0

    def cross(o, a, b):
        return (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0])

    lower: List[Tuple[float, float]] = []
    for p in pts:
        while len(lower) >= 2 and cross(lower[-2], lower[-1], p) <= 0:
            lower.pop()
        lower.append(p)
    upper: List[Tuple[float, float]] = []
    for p in reversed(pts):
        while len(upper) >= 2 and cross(upper[-2], upper[-1], p) <= 0:
            upper.pop()
        upper.append(p)
    hull = lower[:-1] + upper[:-1]
    best = math.inf
    for i in range(len(hull)):
        a, b = hull[i], hull[(i + 1) % len(hull)]
        ex, ey = b[0] - a[0], b[1] - a[1]
        el = math.hypot(ex, ey)
        if el == 0:
            continue
        width = max(abs((p[0] - a[0]) * ey - (p[1] - a[1]) * ex) / el for p in hull)
        best = min(best, width)
    return 0.0 if best is math.inf else best


_CURVED = ("cylinder", "cone", "torus", "sphere")


def detect_drawn_shell(shape: Any, thickness: float, base_normal: Optional[Vec]) -> Optional[Dict[str, Any]]:
    """The drawn shell of a sheet part, or None when the part has none."""
    if thickness <= 0 or base_normal is None:
        return None
    records = _face_records(shape)
    by_index = {r["index"]: r for r in records}

    twin_of: Dict[int, int] = {}
    for i, a in enumerate(records):
        for b in records[i + 1:]:
            if a["index"] not in twin_of and b["index"] not in twin_of and _twins(a, b, thickness):
                twin_of[a["index"]] = b["index"]
                twin_of[b["index"]] = a["index"]
    seeds = [i for i in twin_of if by_index[i]["kind"] in ("torus", "sphere")]
    if not seeds:
        return None

    from sheet_metal.bend_relationships import _build_edge_face_adjacency
    _faces, adj = _build_edge_face_adjacency(shape)
    region: set = set()
    stack = list(seeds)
    while stack:
        i = stack.pop()
        if i in region or by_index[i]["kind"] not in _CURVED:
            continue
        region.add(i)
        stack.extend(adj.get(i, ()))

    axis = _unit(base_normal)
    ref = (1.0, 0.0, 0.0) if abs(axis[0]) < 0.9 else (0.0, 1.0, 0.0)
    u = _unit(_cross(axis, ref))
    v = _cross(axis, u)
    # Fine sampling: a full circle sampled at n points reads as a polygon
    # whose narrowest width is D*cos(pi/n) -- 64 keeps that under 0.13%.
    region_pts = [p for i in region for p in _sample_points(by_index[i], 64)]
    all_pts = [p for r in records for p in _sample_points(r, 2)]
    along = [_dot(p, axis) for p in all_pts]
    depth = max(along) - min(along)
    width = _min_width_2d([(_dot(p, u), _dot(p, v)) for p in region_pts])
    developed = sum(by_index[i]["area"] for i in twin_of) / 2.0
    centroid = tuple(sum(c) / len(region_pts) for c in zip(*region_pts))

    return {
        "recognition_status": "recognized",
        "face_ids": sorted(region),
        "twin_pairs": len(twin_of) // 2,
        "draw_axis": [round(c, 4) for c in axis],
        "depth_mm": round(depth, 2),
        "opening_width_mm": round(width, 2),
        "depth_to_width": round(depth / width, 3) if width > 0 else None,
        "developed_area_mm2": round(developed, 1),
        "centroid_mm": [round(c, 2) for c in centroid],
        "curved_faces": [
            {"kind": by_index[i]["kind"], "dir": list(by_index[i].get("dir", ())), "point": list(by_index[i]["point"]),
             "radius": by_index[i].get("radius")}
            for i in sorted(region) if by_index[i]["kind"] in ("cylinder", "cone")
        ],
    }


def is_drawn_cylinder(shell: Optional[Dict[str, Any]], direction: Sequence[float], axis_point: Sequence[float],
                      radius: float, thickness: float) -> bool:
    """A bend candidate (axis + radius) that is really one of the drawn shell's
    own cylinders -- same axis line, radius within one thickness."""
    if not shell:
        return False
    d = _unit(tuple(direction))  # type: ignore[arg-type]
    p = tuple(axis_point)
    for c in shell["curved_faces"]:
        if c["kind"] != "cylinder" or c["radius"] is None:
            continue
        if _same_axis(tuple(c["dir"]), tuple(c["point"]), d, p) and abs(c["radius"] - radius) <= thickness + _POS_TOL:  # type: ignore[arg-type]
            return True
    return False
