"""
Face adjacency and flat-wall queries on a B-rep, by the face's explorer ordinal (the same ordinal
every feature's `face_ids` use, and the one the viewer's face_map is built on).

A "wall" of a cylindrical arc is a flat face that shares an edge with it and whose normal is
perpendicular to the arc's axis: the straight side of a slot. Flatness is read from the surface
itself (both principal curvatures ~0), so a plane written as a B-spline counts, and a gently curved
surface does not.
"""
from __future__ import annotations

import math
from typing import Dict, List, Optional, Set, Tuple

FLAT_CURVATURE = 1e-4          # 1/mm: a face is flat when both principal curvatures are below this
PERPENDICULAR_DOT = 0.02       # |normal . axis| below this = the normal is perpendicular to the axis


class FaceTopology:
    def __init__(self, shape):
        from OCC.Core.TopAbs import TopAbs_EDGE, TopAbs_FACE  # type: ignore
        from OCC.Core.TopExp import TopExp_Explorer, topexp  # type: ignore
        from OCC.Core.TopTools import TopTools_IndexedDataMapOfShapeListOfShape  # type: ignore
        from OCC.Core.TopoDS import topods  # type: ignore

        self._faces: List = []
        exp = TopExp_Explorer(shape, TopAbs_FACE)
        while exp.More():
            self._faces.append(topods.Face(exp.Current()))
            exp.Next()
        self._edge_faces = TopTools_IndexedDataMapOfShapeListOfShape()
        topexp.MapShapesAndAncestors(shape, TopAbs_EDGE, TopAbs_FACE, self._edge_faces)
        self._ordinal: Dict[int, int] = {}
        for i, f in enumerate(self._faces):
            self._ordinal[f.HashCode(2 ** 31 - 1)] = i
        self._flat_normal_cache: Dict[int, Optional[Tuple[float, float, float]]] = {}
        self._neighbour_cache: Dict[int, Set[int]] = {}

    def neighbours(self, ordinal: int) -> Set[int]:
        """Ordinals of the faces that share an edge with this face."""
        if ordinal in self._neighbour_cache:
            return self._neighbour_cache[ordinal]
        from OCC.Core.TopAbs import TopAbs_EDGE  # type: ignore
        from OCC.Core.TopExp import TopExp_Explorer  # type: ignore
        from OCC.Core.TopTools import TopTools_ListIteratorOfListOfShape  # type: ignore

        out: Set[int] = set()
        if 0 <= ordinal < len(self._faces):
            exp = TopExp_Explorer(self._faces[ordinal], TopAbs_EDGE)
            while exp.More():
                edge = exp.Current()
                if self._edge_faces.Contains(edge):
                    it = TopTools_ListIteratorOfListOfShape(self._edge_faces.FindFromKey(edge))
                    while it.More():
                        o = self._ordinal.get(it.Value().HashCode(2 ** 31 - 1))
                        if o is not None and o != ordinal:
                            out.add(o)
                        it.Next()
                exp.Next()
        self._neighbour_cache[ordinal] = out
        return out

    def flat_normal(self, ordinal: int) -> Optional[Tuple[float, float, float]]:
        """The unit normal of a flat face, or None when the face is curved (or cannot be read)."""
        if ordinal in self._flat_normal_cache:
            return self._flat_normal_cache[ordinal]
        result = self._read_flat_normal(ordinal)
        self._flat_normal_cache[ordinal] = result
        return result

    def _read_flat_normal(self, ordinal: int) -> Optional[Tuple[float, float, float]]:
        from OCC.Core.BRep import BRep_Tool  # type: ignore
        from OCC.Core.BRepTools import breptools  # type: ignore
        from OCC.Core.GeomLProp import GeomLProp_SLProps  # type: ignore

        if not 0 <= ordinal < len(self._faces):
            return None
        face = self._faces[ordinal]
        surface = BRep_Tool.Surface(face)
        if surface is None:
            return None
        u1, u2, v1, v2 = breptools.UVBounds(face)
        if not all(math.isfinite(x) for x in (u1, u2, v1, v2)):
            return None
        normal: Optional[Tuple[float, float, float]] = None
        for fu, fv in ((0.5, 0.5), (0.2, 0.2), (0.8, 0.8), (0.2, 0.8), (0.8, 0.2)):
            props = GeomLProp_SLProps(surface, u1 + (u2 - u1) * fu, v1 + (v2 - v1) * fv, 2, 1e-7)
            if not (props.IsNormalDefined() and props.IsCurvatureDefined()):
                return None
            if abs(props.MaxCurvature()) > FLAT_CURVATURE or abs(props.MinCurvature()) > FLAT_CURVATURE:
                return None
            n = props.Normal()
            this = (n.X(), n.Y(), n.Z())
            if normal is not None and abs(sum(a * b for a, b in zip(normal, this))) < 0.9999:
                return None
            normal = this
        return normal

    def walls_of(self, ordinals: List[int], axis: Tuple[float, float, float]) -> Set[int]:
        """Flat faces next to any of these faces whose normal is perpendicular to `axis`."""
        walls: Set[int] = set()
        for o in ordinals:
            for n in self.neighbours(o):
                if n in ordinals:
                    continue
                normal = self.flat_normal(n)
                if normal is not None and abs(sum(a * b for a, b in zip(normal, axis))) <= PERPENDICULAR_DOT:
                    walls.add(n)
        return walls
