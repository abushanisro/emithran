"""
Shared, cross-domain face-adjacency primitive — extracted from
sheet_metal/bend_relationships.py's _build_edge_face_adjacency (2026-10 Die
Casting Phase 1 prerequisite refactor), the same real OCC technique
memory_optimizer.py's own hole-rim adjacency pass already uses
(TopExp.MapShapesAndAncestors, EDGE -> FACE), generalized to the whole shape.

Real, standard OCC adjacency: for every face, which OTHER faces share an edge
with it. Pure topology, no domain-specific assumption — a second domain
(Die Casting's combo_void.py, grouping undercut-candidate faces into real
connected components) reuses this exact function rather than duplicating it.
"""
from __future__ import annotations

from typing import Any, Dict, List, Tuple

from OCC.Core.TopAbs import TopAbs_EDGE, TopAbs_FACE  # type: ignore
from OCC.Core.TopExp import TopExp_Explorer, topexp  # type: ignore
from OCC.Core.TopoDS import topods  # type: ignore
from OCC.Core.TopTools import (  # type: ignore
    TopTools_IndexedDataMapOfShapeListOfShape,
    TopTools_IndexedMapOfShape,
    TopTools_ListIteratorOfListOfShape,
)


def build_edge_face_adjacency(shape: Any) -> Tuple[List[Any], Dict[int, set]]:
    """Returns (faces, adjacency) where faces[i] is the i-th face in standard
    TopExp_Explorer order, and adjacency[i] is the set of face indices
    sharing a real edge with face i."""
    faces: List[Any] = []
    exp = TopExp_Explorer(shape, TopAbs_FACE)
    while exp.More():
        faces.append(topods.Face(exp.Current()))
        exp.Next()

    edge_face_map = TopTools_IndexedDataMapOfShapeListOfShape()
    topexp.MapShapesAndAncestors(shape, TopAbs_EDGE, TopAbs_FACE, edge_face_map)
    face_indexed = TopTools_IndexedMapOfShape()
    for f in faces:
        face_indexed.Add(f)

    adjacency: Dict[int, set] = {i: set() for i in range(len(faces))}
    for i in range(1, edge_face_map.Size() + 1):
        adj_list = edge_face_map.FindFromIndex(i)
        it = TopTools_ListIteratorOfListOfShape(adj_list)
        touching = []
        while it.More():
            fi = face_indexed.FindIndex(it.Value()) - 1
            if fi >= 0:
                touching.append(fi)
            it.Next()
        for a in touching:
            for b in touching:
                if a != b:
                    adjacency[a].add(b)
    return faces, adjacency
