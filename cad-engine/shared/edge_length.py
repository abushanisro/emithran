"""
Sharp-edge length of a B-Rep solid — the real edge length a deburring
operation has to travel.

An edge needs deburring when the two faces it separates meet at a crease
(C0 continuity). Excluded, because they are not physical edges of the part:
  * seam edges — a closed surface (cylinder, cone, sphere) meeting itself;
  * smooth edges — two faces that are tangent-continuous across the edge
    (a fillet running into a flat), which leave no burr.
Continuity is set from the geometry itself (BRepLib.EncodeRegularity with
the angular tolerance below) before it is read, so it does not depend on
how the exporting CAD system flagged the edges.

Each edge is counted once (TopExp.MapShapesAndAncestors dedupes edges shared
by two faces). Lengths come from BRepGProp linear properties — the true
curve length, arcs included.
"""
from __future__ import annotations

import math
from typing import Dict

from OCC.Core.BRep import BRep_Tool
from OCC.Core.BRepGProp import brepgprop
from OCC.Core.BRepLib import breplib
from OCC.Core.GeomAbs import GeomAbs_C0
from OCC.Core.GProp import GProp_GProps
from OCC.Core.TopAbs import TopAbs_EDGE, TopAbs_FACE
from OCC.Core.TopExp import topexp
from OCC.Core.TopoDS import topods
from OCC.Core.TopTools import TopTools_IndexedDataMapOfShapeListOfShape, TopTools_ListIteratorOfListOfShape

# Two faces within 1 degree of tangency across an edge are treated as
# continuous — the standard regularity tolerance for "no visible crease".
SMOOTH_ANGLE_TOLERANCE_RAD = math.radians(1.0)


def sharp_edge_length(shape) -> Dict[str, float]:
    """Returns {"sharp_edge_length_mm", "sharp_edge_count", "total_edge_length_mm"}."""
    breplib.EncodeRegularity(shape, SMOOTH_ANGLE_TOLERANCE_RAD)
    edge_faces = TopTools_IndexedDataMapOfShapeListOfShape()
    topexp.MapShapesAndAncestors(shape, TopAbs_EDGE, TopAbs_FACE, edge_faces)

    sharp_len = 0.0
    total_len = 0.0
    sharp_count = 0
    for i in range(1, edge_faces.Size() + 1):
        edge = topods.Edge(edge_faces.FindKey(i))
        if BRep_Tool.Degenerated(edge):
            continue
        props = GProp_GProps()
        brepgprop.LinearProperties(edge, props)
        length = props.Mass()
        total_len += length

        faces = []
        it = TopTools_ListIteratorOfListOfShape(edge_faces.FindFromIndex(i))
        while it.More():
            faces.append(it.Value())
            it.Next()
        if len(faces) != 2:
            continue  # free/non-manifold edge: not an edge between two part faces
        f1, f2 = topods.Face(faces[0]), topods.Face(faces[1])
        if f1.IsSame(f2):
            continue  # seam of a closed surface
        if BRep_Tool.Continuity(edge, f1, f2) != GeomAbs_C0:
            continue  # tangent-continuous: no crease, no burr
        sharp_len += length
        sharp_count += 1

    return {
        "sharp_edge_length_mm": round(sharp_len, 3),
        "sharp_edge_count": sharp_count,
        "total_edge_length_mm": round(total_len, 3),
    }
