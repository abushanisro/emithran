"""
One pass over a B-Rep that yields the facts every domain recognizer and the 3D
viewer need about faces and the edges between them, so they stop being
recomputed (and thrown away) separately per detector:

  face_attributes[i]  surface type, area, centroid, outward normal (planes) or
                      axis (cylinders/cones), radius, orientation
  edge_graph          one entry per edge shared by two distinct faces, with its
                      convexity (convex / concave / smooth) and dihedral angle

This is the attributed adjacency graph the feature-recognition literature
builds on: faces are nodes, shared edges are arcs carrying convexity.

Face index i is the TopExp_Explorer ordinal, the same face_id used by face_map
and feature_graph_v2 (a runtime ordinal, see stable_face_id.py for identity
across regenerations).

Convexity test. For an edge traversed as it appears in face A's wire, the
material of A lies to the left of the traversal when seen against A's outward
normal nA, so the direction from the edge into A is  dA = nA x t.  The other
face B's outward normal nB points away from material: if nB . dA < 0 the two
faces fold away from each other (convex edge, like a box corner); if > 0, B
rises out of A's interior (concave edge, like a pocket wall meeting its floor).
"""
from __future__ import annotations

import math
from typing import Any, Dict, List, Optional, Tuple

from OCC.Core.BRep import BRep_Tool  # type: ignore
from OCC.Core.BRepAdaptor import BRepAdaptor_Curve, BRepAdaptor_Surface  # type: ignore
from OCC.Core.BRepGProp import brepgprop  # type: ignore
from OCC.Core.BRepLProp import BRepLProp_SLProps  # type: ignore
from OCC.Core.GProp import GProp_GProps  # type: ignore
from OCC.Core.GeomAbs import (  # type: ignore
    GeomAbs_BSplineSurface, GeomAbs_BezierSurface, GeomAbs_Cone, GeomAbs_Cylinder,
    GeomAbs_Plane, GeomAbs_Sphere, GeomAbs_SurfaceOfExtrusion,
    GeomAbs_SurfaceOfRevolution, GeomAbs_Torus,
)
from OCC.Core.TopAbs import TopAbs_EDGE, TopAbs_FACE, TopAbs_REVERSED  # type: ignore
from OCC.Core.TopExp import TopExp_Explorer, topexp  # type: ignore
from OCC.Core.TopoDS import topods  # type: ignore
from OCC.Core.TopTools import (  # type: ignore
    TopTools_IndexedDataMapOfShapeListOfShape,
    TopTools_IndexedMapOfShape,
    TopTools_ListIteratorOfListOfShape,
)

# Dihedral angles below this are tangent-continuous (a fillet blending into its
# neighbour), not a crease.
SMOOTH_DIHEDRAL_DEG = 2.0

_SURFACE_NAMES = {
    GeomAbs_Plane: "plane",
    GeomAbs_Cylinder: "cylinder",
    GeomAbs_Cone: "cone",
    GeomAbs_Sphere: "sphere",
    GeomAbs_Torus: "torus",
    GeomAbs_BSplineSurface: "bspline",
    GeomAbs_BezierSurface: "bezier",
    GeomAbs_SurfaceOfRevolution: "revolution",
    GeomAbs_SurfaceOfExtrusion: "extrusion",
}


def _xyz(v: Any) -> Tuple[float, float, float]:
    return (float(v.X()), float(v.Y()), float(v.Z()))


def _round3(v: Tuple[float, float, float]) -> List[float]:
    return [round(v[0], 4), round(v[1], 4), round(v[2], 4)]


def _cross(a, b):
    return (a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0])


def _dot(a, b) -> float:
    return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]


def _unit(v):
    m = math.sqrt(_dot(v, v))
    return (v[0] / m, v[1] / m, v[2] / m) if m > 1e-12 else None


def _face_attributes(face: Any) -> Dict[str, Any]:
    adaptor = BRepAdaptor_Surface(face)
    stype = _SURFACE_NAMES.get(adaptor.GetType(), "other")
    props = GProp_GProps()
    brepgprop.SurfaceProperties(face, props)
    c = props.CentreOfMass()
    reversed_ = face.Orientation() == TopAbs_REVERSED
    out: Dict[str, Any] = {
        "surface_type": stype,
        "area_mm2": round(float(props.Mass()), 3),
        "centroid": _round3(_xyz(c)),
        "reversed": reversed_,
    }
    if stype == "plane":
        n = _xyz(adaptor.Plane().Axis().Direction())
        out["normal"] = _round3((-n[0], -n[1], -n[2]) if reversed_ else n)
    elif stype == "cylinder":
        cyl = adaptor.Cylinder()
        out["axis"] = _round3(_xyz(cyl.Axis().Direction()))
        out["radius_mm"] = round(float(cyl.Radius()), 4)
    elif stype == "cone":
        cone = adaptor.Cone()
        out["axis"] = _round3(_xyz(cone.Axis().Direction()))
        out["radius_mm"] = round(float(cone.RefRadius()), 4)
    elif stype == "sphere":
        out["radius_mm"] = round(float(adaptor.Sphere().Radius()), 4)
    return out


def _outward_normal_at(edge: Any, face: Any, param: float) -> Optional[Tuple[float, float, float]]:
    """Outward unit normal of `face` at the point of `edge` at curve parameter `param`."""
    curve2d, first, last = BRep_Tool.CurveOnSurface(edge, face)
    if curve2d is None:
        return None
    # `param` is expressed on the edge's 3D curve range; map to the pcurve range.
    uv = curve2d.Value(param)
    sl = BRepLProp_SLProps(BRepAdaptor_Surface(face), uv.X(), uv.Y(), 1, 1e-6)
    if not sl.IsNormalDefined():
        return None
    n = _xyz(sl.Normal())
    if face.Orientation() == TopAbs_REVERSED:
        n = (-n[0], -n[1], -n[2])
    return _unit(n)


def _classify_edge(edge_in_a: Any, face_a: Any, face_b: Any) -> Optional[Dict[str, Any]]:
    curve = BRepAdaptor_Curve(edge_in_a)
    first, last = curve.FirstParameter(), curve.LastParameter()
    mid = 0.5 * (first + last)
    pnt, tan = curve.Value(mid), curve.DN(mid, 1)
    t = _unit(_xyz(tan))
    if t is None:
        return None
    # Traversal direction as the edge appears in face A's wire.
    if edge_in_a.Orientation() == TopAbs_REVERSED:
        t = (-t[0], -t[1], -t[2])
    na = _outward_normal_at(edge_in_a, face_a, mid)
    nb = _outward_normal_at(edge_in_a, face_b, mid)
    if na is None or nb is None:
        return None
    dihedral = math.degrees(math.acos(max(-1.0, min(1.0, _dot(na, nb)))))
    if dihedral < SMOOTH_DIHEDRAL_DEG:
        kind = "smooth"
    else:
        d_a = _cross(na, t)  # direction from the edge into face A
        kind = "convex" if _dot(nb, d_a) < 0 else "concave"
    return {"convexity": kind, "dihedral_deg": round(dihedral, 2)}


def build_face_attributes(shape: Any) -> Tuple[List[Dict[str, Any]], List[Dict[str, Any]]]:
    """Returns (face_attributes, edge_graph) for the shape, one pass each.

    face_attributes[i] describes the i-th face in TopExp_Explorer order.
    edge_graph entries are {"a", "b", "convexity", "dihedral_deg"} with a < b;
    seam edges (a face meeting itself) and edges whose normals are undefined
    are omitted rather than guessed.
    """
    faces: List[Any] = []
    face_index = TopTools_IndexedMapOfShape()
    exp = TopExp_Explorer(shape, TopAbs_FACE)
    while exp.More():
        face = topods.Face(exp.Current())
        faces.append(face)
        face_index.Add(face)
        exp.Next()

    attributes = [_face_attributes(f) for f in faces]

    edge_faces = TopTools_IndexedDataMapOfShapeListOfShape()
    topexp.MapShapesAndAncestors(shape, TopAbs_EDGE, TopAbs_FACE, edge_faces)

    # Each shared edge once, classified from the first face's point of view.
    seen: set = set()
    edges: List[Dict[str, Any]] = []
    for ai, face_a in enumerate(faces):
        ee = TopExp_Explorer(face_a, TopAbs_EDGE)
        while ee.More():
            edge = topods.Edge(ee.Current())
            ee.Next()
            idx = edge_faces.FindIndex(edge)
            if idx <= 0:
                continue
            others = []
            it = TopTools_ListIteratorOfListOfShape(edge_faces.FindFromIndex(idx))
            while it.More():
                bi = face_index.FindIndex(it.Value()) - 1
                it.Next()
                if bi >= 0 and bi != ai:
                    others.append(bi)
            if len(others) != 1:
                continue  # seam, open edge or non-manifold: no two-face dihedral
            bi = others[0]
            key = (edge_faces.FindIndex(edge), min(ai, bi))
            if key in seen:
                continue
            seen.add(key)
            try:
                result = _classify_edge(edge, face_a, faces[bi])
            except Exception:
                result = None
            if result is None:
                continue
            edges.append({"a": min(ai, bi), "b": max(ai, bi), "convexity": result["convexity"],
                          "dihedral_deg": result["dihedral_deg"]})
    return attributes, edges
