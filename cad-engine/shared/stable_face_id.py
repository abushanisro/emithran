"""
Stable, content-based face identity — independent of OCC's runtime face
enumeration order.

WHY THIS EXISTS

Every face_idx in this codebase (raw_cylinders_full's 9th tuple element,
feature_graph_v2's occurrence face_ids, the face_map metadata) is a
TopExp_Explorer enumeration-order ordinal for ONE specific in-memory shape
object — feature_extractor.extract()'s own docstring says so outright:
"face_index is a runtime OCC face ordinal — NOT stable across STEP
regeneration." Re-importing or re-tessellating "the same" part can silently
renumber every face, so a stored face_idx from one extraction run cannot be
trusted to mean the same physical face in a later run.

THE FIX, AND WHY IT IS REAL, NOT A GUESS

A face's own real geometry — its surface type, area, and centroid — does
NOT depend on OCC's traversal order. Two extractions of geometrically
identical faces (same part, re-exported/re-tessellated) produce the SAME
hash; two genuinely DIFFERENT real faces would have to coincide in surface
type, area (to 0.001mm^2) AND centroid (to 0.001mm) to collide — which, for
real distinct faces, does not happen (that degree of coincidence would mean
they are the same face).

WHAT THIS DELIBERATELY DOES NOT DO

It does not replace face_idx anywhere — every existing consumer (bend/hole/
formed-feature/lance detection, feature_graph_v2's occurrence face_ids, the
3D highlight face_map) keeps using the fast, session-local ordinal exactly as
before. This is purely additive: a stable_face_ids map from that SAME
ordinal to a persistent content hash, so a consumer that needs cross-run
identity (DFM history, "what changed since last extraction") can look one up
without every existing call site needing to change.

It does not attempt edge identity, only face identity — the concrete need
(feature_graph_v2's face_ids are all faces, no edges) does not require it,
and an edge has no comparably simple geometric invariant (a real edge's own
midpoint/length collides far more easily across unrelated features than a
face's area+centroid does).
"""

import hashlib
from typing import Any, Dict

from OCC.Core.BRepAdaptor import BRepAdaptor_Surface  # type: ignore
from OCC.Core.BRepGProp import brepgprop  # type: ignore
from OCC.Core.GProp import GProp_GProps  # type: ignore
from OCC.Core.GeomAbs import (  # type: ignore
    GeomAbs_Plane, GeomAbs_Cylinder, GeomAbs_Cone, GeomAbs_Sphere, GeomAbs_Torus,
    GeomAbs_BSplineSurface, GeomAbs_BezierSurface, GeomAbs_SurfaceOfRevolution,
    GeomAbs_SurfaceOfExtrusion, GeomAbs_OffsetSurface,
)
from OCC.Core.TopAbs import TopAbs_FACE  # type: ignore
from OCC.Core.TopExp import TopExp_Explorer  # type: ignore
from OCC.Core.TopoDS import topods  # type: ignore

_SURFACE_TYPE_NAMES = {
    GeomAbs_Plane: "plane",
    GeomAbs_Cylinder: "cylinder",
    GeomAbs_Cone: "cone",
    GeomAbs_Sphere: "sphere",
    GeomAbs_Torus: "torus",
    GeomAbs_BSplineSurface: "bspline",
    GeomAbs_BezierSurface: "bezier",
    GeomAbs_SurfaceOfRevolution: "revolution",
    GeomAbs_SurfaceOfExtrusion: "extrusion",
    GeomAbs_OffsetSurface: "offset",
}


def compute_stable_face_id(face: Any) -> str:
    """
    A content-based identity for one face: a SHA256 hash (first 16 hex
    chars) of its surface type, real area, and real centroid, all rounded to
    a manufacturing-relevant tolerance. See module docstring for why this is
    sound and what it deliberately does not attempt.
    """
    try:
        adaptor = BRepAdaptor_Surface(face)
        surface_type = _SURFACE_TYPE_NAMES.get(adaptor.GetType(), f"other_{int(adaptor.GetType())}")
    except Exception:
        surface_type = "unknown"

    props = GProp_GProps()
    brepgprop.SurfaceProperties(face, props)
    area = props.Mass()
    cg = props.CentreOfMass()

    fingerprint = f"{surface_type}|{area:.3f}|{cg.X():.3f}|{cg.Y():.3f}|{cg.Z():.3f}"
    return hashlib.sha256(fingerprint.encode()).hexdigest()[:16]


def build_stable_face_id_map(shape: Any) -> Dict[int, str]:
    """
    One stable id per face, keyed by the SAME TopExp_Explorer enumeration-
    order ordinal every other face_idx in this codebase already uses (bend/
    hole/formed-feature/lance detection, feature_graph_v2's face_map) —
    explorer traversal order for a given in-memory shape is deterministic, so
    this ordinal matches theirs as long as nothing filters/reorders the
    faces first, which nothing here does.
    """
    ids: Dict[int, str] = {}
    exp = TopExp_Explorer(shape, TopAbs_FACE)
    idx = 0
    while exp.More():
        try:
            face = topods.Face(exp.Current())
            ids[idx] = compute_stable_face_id(face)
        except Exception:
            pass
        idx += 1
        exp.Next()
    return ids
