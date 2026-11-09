"""
Blend radii: fillets and corner/edge rounds, measured from the B-Rep.

A blend is a cylindrical, toroidal or spherical face that is tangent-continuous (normals within TANGENT_ANGLE_DEG) with at
least one neighbouring face that is NOT the same surface. That separates a fillet or a rounded corner from a bore or a boss
(whose wall meets its neighbours at a sharp edge) and from one hole wall split into two coaxial half-cylinders (same surface).

Radius: cylinder radius; torus MINOR radius (the rolling-ball radius of a fillet round a boss); sphere radius.
Concave / convex: from the exact outward normal at the face's samples against the vector from the surface's own axis (or
centre, or tube centre) to the point. Convex = material inside the radius (a rounded edge or corner); concave = material
outside it (a fillet in an inside corner). Staged forging rules name them InsufficientFilletRadius and
InsufficientCornerRadius; mapping fillet = concave and corner = convex is the extractor's reading and is flagged as such in
the contract. The extractor reports radii; the DFM service applies the per-material minimums.
"""
from __future__ import annotations

import math
from typing import Any, Dict, List, Optional, Sequence, Tuple

from .constants import SAME_SURFACE_TOLERANCE_MM, TANGENT_ANGLE_DEG
from .sampling import FaceRecord, exact_normal_at

_BLEND_TYPES = ("cylinder", "torus", "sphere")


def _sub(a, b):
    return (a[0] - b[0], a[1] - b[1], a[2] - b[2])


def _dot(a, b):
    return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]


def _unit(a):
    n = math.sqrt(_dot(a, a)) or 1.0
    return (a[0] / n, a[1] / n, a[2] / n)


def _surface_params(face: Any, kind: str) -> Optional[Dict[str, Any]]:
    """Radius, reference geometry and axis of a blend surface, from the real OCC surface."""
    from OCC.Core.BRepAdaptor import BRepAdaptor_Surface  # type: ignore
    ad = BRepAdaptor_Surface(face)
    if kind == "cylinder":
        c = ad.Cylinder()
        ax = c.Axis()
        loc, dr = ax.Location(), ax.Direction()
        return {"radius": c.Radius(), "origin": (loc.X(), loc.Y(), loc.Z()), "axis": (dr.X(), dr.Y(), dr.Z())}
    if kind == "torus":
        t = ad.Torus()
        ax = t.Axis()
        loc, dr = ax.Location(), ax.Direction()
        return {"radius": t.MinorRadius(), "major": t.MajorRadius(), "origin": (loc.X(), loc.Y(), loc.Z()), "axis": (dr.X(), dr.Y(), dr.Z())}
    if kind == "sphere":
        s = ad.Sphere()
        loc = s.Location()
        return {"radius": s.Radius(), "origin": (loc.X(), loc.Y(), loc.Z()), "axis": None}
    return None


def _is_convex(kind: str, prm: Dict[str, Any], point, normal) -> bool:
    o = prm["origin"]
    q = _sub(point, o)
    if kind == "sphere":
        return _dot(normal, q) > 0
    ax = prm["axis"]
    along = _dot(q, ax)
    radial = (q[0] - along * ax[0], q[1] - along * ax[1], q[2] - along * ax[2])
    if kind == "torus":  # the tube centre is on the circle of the major radius, in the direction of the radial vector
        rl = _unit(radial)
        centre = tuple(o[i] + along * ax[i] + prm["major"] * rl[i] for i in range(3))
        return _dot(normal, _sub(point, centre)) > 0
    return _dot(normal, radial) > 0


def _same_cylinder(a: Dict[str, Any], b: Dict[str, Any]) -> bool:
    if abs(a["radius"] - b["radius"]) > SAME_SURFACE_TOLERANCE_MM:
        return False
    if abs(abs(_dot(a["axis"], b["axis"])) - 1.0) > 1e-6:
        return False
    d = _sub(b["origin"], a["origin"])
    along = _dot(d, a["axis"])
    off = tuple(d[i] - along * a["axis"][i] for i in range(3))
    return math.sqrt(_dot(off, off)) <= SAME_SURFACE_TOLERANCE_MM


def _edge_midpoint(edge: Any):
    from OCC.Core.BRepAdaptor import BRepAdaptor_Curve  # type: ignore
    c = BRepAdaptor_Curve(edge)
    p = c.Value(0.5 * (c.FirstParameter() + c.LastParameter()))
    return (p.X(), p.Y(), p.Z())


def analyze_blends(shape: Any, faces: List[FaceRecord], pull_direction: Optional[Sequence[float]] = None) -> Dict[str, Any]:
    from OCC.Core.TopAbs import TopAbs_EDGE, TopAbs_FACE  # type: ignore
    from OCC.Core.TopExp import topexp  # type: ignore
    from OCC.Core.TopTools import (  # type: ignore
        TopTools_IndexedDataMapOfShapeListOfShape, TopTools_IndexedMapOfShape, TopTools_ListIteratorOfListOfShape,
    )
    from OCC.Core.TopoDS import topods  # type: ignore

    face_map = TopTools_IndexedMapOfShape()
    topexp.MapShapes(shape, TopAbs_FACE, face_map)
    edge_faces = TopTools_IndexedDataMapOfShapeListOfShape()
    topexp.MapShapesAndAncestors(shape, TopAbs_EDGE, TopAbs_FACE, edge_faces)

    by_index = {f.index: f for f in faces}
    # face -> [(edge, neighbour face index)], seams (the same face on both sides) dropped
    neighbours: Dict[int, List[Tuple[Any, int]]] = {}
    for i in range(1, edge_faces.Size() + 1):
        edge = topods.Edge(edge_faces.FindKey(i))
        it = TopTools_ListIteratorOfListOfShape(edge_faces.FindFromIndex(i))
        idx: List[int] = []
        while it.More():
            idx.append(face_map.FindIndex(it.Value()) - 1)
            it.Next()
        if len(idx) == 2 and idx[0] != idx[1]:
            neighbours.setdefault(idx[0], []).append((edge, idx[1]))
            neighbours.setdefault(idx[1], []).append((edge, idx[0]))

    cos_tangent = math.cos(math.radians(TANGENT_ANGLE_DEG))
    blends: List[Dict[str, Any]] = []
    params_cache: Dict[int, Optional[Dict[str, Any]]] = {}

    def params(idx: int) -> Optional[Dict[str, Any]]:
        if idx not in params_cache:
            fr = by_index.get(idx)
            params_cache[idx] = _surface_params(fr.face, fr.surface_type) if fr and fr.surface_type in _BLEND_TYPES else None
        return params_cache[idx]

    for fr in faces:
        if fr.surface_type not in _BLEND_TYPES or not fr.samples:
            continue
        prm = params(fr.index)
        if not prm:
            continue
        tangent = False
        for edge, nb in neighbours.get(fr.index, []):
            other = by_index.get(nb)
            if other is None:
                continue
            if other.surface_type == fr.surface_type == "cylinder":
                op = params(nb)
                if op and _same_cylinder(prm, op):
                    continue  # one cylinder split in two faces, not a blend
            mid = _edge_midpoint(edge)
            a, b = exact_normal_at(fr.face, mid), exact_normal_at(other.face, mid)
            if a and b and _dot(a[1], b[1]) >= cos_tangent:
                tangent = True
                break
        if not tangent:
            continue
        w_convex = sum(s.weight_mm2 for s in fr.samples if _is_convex(fr.surface_type, prm, s.point, s.normal))
        w_all = sum(s.weight_mm2 for s in fr.samples)
        if w_all <= 0 or 0.05 < w_convex / w_all < 0.95:
            continue  # neither clearly convex nor clearly concave: not reported as a blend
        rec: Dict[str, Any] = {
            "face_index": fr.index,
            "surface_type": fr.surface_type,
            "radius_mm": round(prm["radius"], 4),
            "concave": (w_convex / w_all) <= 0.05,
            "area_mm2": round(fr.area_mm2, 3),
        }
        if prm.get("axis") is not None:
            rec["axis"] = [round(v, 6) for v in prm["axis"]]
            if pull_direction is not None:
                c = abs(_dot(prm["axis"], pull_direction))
                rec["axis_angle_to_pull_deg"] = round(math.degrees(math.acos(min(1.0, c))), 3)
        blends.append(rec)

    concave = [b["radius_mm"] for b in blends if b["concave"]]
    convex = [b["radius_mm"] for b in blends if not b["concave"]]
    return {
        "definition": "cylindrical/toroidal/spherical faces tangent (within 1 degree) to a neighbouring face of a different surface",
        "blend_count": len(blends),
        "min_concave_radius_mm": min(concave) if concave else None,
        "min_convex_radius_mm": min(convex) if convex else None,
        "blends": blends,
    }
