"""
Whether a planar face is the floor of a recess, and how deep the recess is.

A floor is recessed when a wall stands on one of its edges: a face that meets it in an inside corner (a pocket
or step wall, a boss standing on it), or a floor fillet that rises from it across a smooth edge. The top of a rib or a boss has no such neighbour (every face
around it falls away), so it is not a floor; nothing was cut out above it.

  depth_mm         how far the tallest wall rises above the floor. Across a smooth edge (a floor fillet) the wall
                   continues in the fillet's own neighbours, so those are measured too.
  walled_fraction  the share of the floor's outer boundary that has a wall. 1 is a closed pocket, about a half or
                   less an open step.
  width_confined   walls stand on both sides of the floor across its width, each along at least half its length:
                   the cutter that machines it can be no wider than the floor. On an open step it is not confined.
  hole_bottom      the walls are one hole's own cylinder all the way round: the flat bottom of a drilled or
                   counterbored hole, which belongs to the hole.

Measured on the exact geometry (edges sampled along their curves); nothing is estimated.
"""
from __future__ import annotations

from typing import Any, Dict, List, Optional, Tuple

import numpy as np

_RISE_TOL_MM = 0.02   # a neighbour rises above the floor when it stands at least this far over the plane
_SAMPLES = 9          # points taken along each edge
_PARALLEL = 0.999


class RecessedFloors:
    """The floor measurements of one shape; the face and edge maps are built once."""

    def __init__(self, shape: Any):
        from OCC.Core.TopAbs import TopAbs_EDGE, TopAbs_FACE  # type: ignore
        from OCC.Core.TopExp import topexp  # type: ignore
        from OCC.Core.TopTools import (  # type: ignore
            TopTools_IndexedDataMapOfShapeListOfShape, TopTools_IndexedMapOfShape,
        )
        self._faces = TopTools_IndexedMapOfShape()
        topexp.MapShapes(shape, TopAbs_FACE, self._faces)
        self._edge_faces = TopTools_IndexedDataMapOfShapeListOfShape()
        topexp.MapShapesAndAncestors(shape, TopAbs_EDGE, TopAbs_FACE, self._edge_faces)

    def _edges(self, face: Any) -> List[Any]:
        from OCC.Core.TopAbs import TopAbs_EDGE  # type: ignore
        from OCC.Core.TopExp import TopExp_Explorer  # type: ignore
        from OCC.Core.TopoDS import topods  # type: ignore
        out, exp = [], TopExp_Explorer(face, TopAbs_EDGE)
        while exp.More():
            out.append(topods.Edge(exp.Current()))
            exp.Next()
        return out

    def _across(self, edge: Any, face: Any) -> List[Any]:
        """The other faces that share the edge."""
        from OCC.Core.TopTools import TopTools_ListIteratorOfListOfShape  # type: ignore
        from OCC.Core.TopoDS import topods  # type: ignore
        out, it = [], TopTools_ListIteratorOfListOfShape(self._edge_faces.FindFromKey(edge))
        while it.More():
            if not it.Value().IsSame(face):
                out.append(topods.Face(it.Value()))
            it.Next()
        return out

    def _rise(self, face: Any, origin: Tuple[float, float, float], normal: Tuple[float, float, float]) -> float:
        """The highest point of a face above the plane through origin, along normal (from its edges)."""
        from OCC.Core.BRepAdaptor import BRepAdaptor_Curve  # type: ignore
        best = float("-inf")
        for edge in self._edges(face):
            curve = BRepAdaptor_Curve(edge)
            lo, hi = curve.FirstParameter(), curve.LastParameter()
            for k in range(_SAMPLES):
                p = curve.Value(lo + (hi - lo) * k / (_SAMPLES - 1))
                best = max(best, (p.X() - origin[0]) * normal[0] + (p.Y() - origin[1]) * normal[1] + (p.Z() - origin[2]) * normal[2])
        return best

    def measure(self, face: Any) -> Optional[Dict[str, Any]]:
        """The floor measurements of a planar face, or None when it is not planar."""
        from OCC.Core.BRep import BRep_Tool  # type: ignore
        from OCC.Core.BRepAdaptor import BRepAdaptor_Curve, BRepAdaptor_Surface  # type: ignore
        from OCC.Core.BRepGProp import brepgprop  # type: ignore
        from OCC.Core.BRepTools import breptools  # type: ignore
        from OCC.Core.GeomAbs import GeomAbs_Cylinder, GeomAbs_Plane, GeomAbs_Torus  # type: ignore
        from OCC.Core.GProp import GProp_GProps  # type: ignore
        from OCC.Core.TopAbs import TopAbs_REVERSED  # type: ignore
        from shared.edge_length import _concavity

        surface = BRepAdaptor_Surface(face)
        if surface.GetType() != GeomAbs_Plane:
            return None
        plane = surface.Plane()
        d, o = plane.Axis().Direction(), plane.Location()
        sign = 1.0 if plane.Direct() else -1.0
        if face.Orientation() == TopAbs_REVERSED:
            sign = -sign
        normal = (d.X() * sign, d.Y() * sign, d.Z() * sign)
        origin = (o.X(), o.Y(), o.Z())

        def length(edge: Any) -> float:
            props = GProp_GProps()
            brepgprop.LinearProperties(edge, props)
            return props.Mass()

        outer = breptools.OuterWire(face)
        outer_edges = self._edges(outer)
        outer_len = sum(length(e) for e in outer_edges)
        walled_len, depth, walls = 0.0, 0.0, []
        boundary: List[Tuple[Tuple[float, float, float], float, bool]] = []  # outer boundary samples: point, length share, walled
        for edge in self._edges(face):
            if BRep_Tool.Degenerated(edge):
                continue
            on_outer = any(edge.IsSame(e) for e in outer_edges)
            edge_walled = False
            for other in self._across(edge, face):
                corner = _concavity(edge, face, other)
                rise = self._rise(other, origin, normal)
                # An inside corner is a wall and an outside corner is not (the face beyond it may still reach
                # above the floor somewhere else). Across a smooth edge, a fillet rises and a rounded edge falls.
                if corner == "external" or rise <= _RISE_TOL_MM:
                    continue
                edge_walled = True
                walls.append(other)
                depth = max(depth, rise)
                if corner != "internal" and BRepAdaptor_Surface(other).GetType() in (GeomAbs_Cylinder, GeomAbs_Torus):
                    # A floor fillet: the wall continues in the fillet's own neighbours.
                    for fillet_edge in self._edges(other):
                        for beyond in self._across(fillet_edge, other):
                            if not beyond.IsSame(face):
                                depth = max(depth, self._rise(beyond, origin, normal))
            if on_outer:
                edge_len = length(edge)
                walled_len += edge_len if edge_walled else 0.0
                curve = BRepAdaptor_Curve(edge)
                lo, hi = curve.FirstParameter(), curve.LastParameter()
                for k in range(_SAMPLES):
                    pt = curve.Value(lo + (hi - lo) * (k + 0.5) / _SAMPLES)
                    boundary.append(((pt.X(), pt.Y(), pt.Z()), edge_len / _SAMPLES, edge_walled))
        walled_fraction = walled_len / outer_len if outer_len > 0 else 0.0

        def hole_wall(other: Any) -> bool:
            s = BRepAdaptor_Surface(other)
            if s.GetType() != GeomAbs_Cylinder or other.Orientation() != TopAbs_REVERSED:
                return False
            a = s.Cylinder().Axis().Direction()
            return abs(a.X() * normal[0] + a.Y() * normal[1] + a.Z() * normal[2]) > _PARALLEL

        area = GProp_GProps()
        brepgprop.SurfaceProperties(face, area)
        return {
            "recessed": bool(walls),
            "depth_mm": depth,
            "walled_fraction": walled_fraction,
            "width_confined": _width_confined(boundary, normal),
            "hole_bottom": bool(walls) and walled_fraction > 0.99 and all(hole_wall(w) for w in walls),
            "area_mm2": area.Mass(),
        }


def _width_confined(boundary: List[Tuple[Tuple[float, float, float], float, bool]], normal: Tuple[float, float, float]) -> bool:
    """True when walls stand on both sides of the floor across its width, each along at least half the floor's length."""
    if not boundary:
        return False
    pts = np.asarray([b[0] for b in boundary], dtype=np.float64)
    share = np.asarray([b[1] for b in boundary], dtype=np.float64)
    walled = np.asarray([b[2] for b in boundary], dtype=bool)
    rel = pts - np.average(pts, axis=0, weights=share)
    # The floor's long direction is the principal axis of its boundary; its width runs square to that, in the plane.
    _vals, vecs = np.linalg.eigh((rel * share[:, None]).T @ rel)
    along = vecs[:, -1]
    across = np.cross(np.asarray(normal), along)
    if float(np.linalg.norm(across)) < 1e-9:
        return False
    across /= np.linalg.norm(across)
    side = rel @ across
    reach = rel @ along
    half_width, length = float(np.abs(side).max()), float(reach.max() - reach.min())
    if half_width <= 0 or length <= 0:
        return False
    one = float(share[walled & (side > half_width / 2)].sum())
    other = float(share[walled & (side < -half_width / 2)].sum())
    return min(one, other) >= length / 2
