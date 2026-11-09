"""
Surface sampling for the forging extractor.

The tessellation is the shared one (casting_geometry._ensure_mesh / _face_triangles: world-space triangles with the
winding flipped for REVERSED faces, so a triangle's normal is the face's outward normal). What this module adds is the
step the shared draft code lacks: every sample's normal is the EXACT surface normal at the sample point (projected onto the
true B-Rep surface and flipped by the face orientation), not the normal of a flat facet. A cone or sphere facet can be
tens of degrees off the true normal at the default angular deflection; a draft angle must not inherit that error.

A face is never judged at one midpoint: up to `max_samples` triangles are chosen across its whole area by systematic
sampling on cumulative area (deterministic), and each carries an equal share of the face's EXACT area, so a face's samples
always weigh exactly the face's area however finely it is meshed.
"""
from __future__ import annotations

import math
from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional, Tuple

from shared.casting_geometry import _cross, _ensure_mesh, _face_triangles, _faces, _norm, _sub

Vec = Tuple[float, float, float]

_SURFACE_NAMES: Optional[Dict[Any, str]] = None


@dataclass
class SurfaceSample:
    point: Vec
    normal: Vec  # unit, outward from the material
    weight_mm2: float


@dataclass
class FaceRecord:
    index: int  # TopExp_Explorer order, the same enumeration every face index in cad-engine uses
    face: Any
    surface_type: str
    area_mm2: float
    samples: List[SurfaceSample] = field(default_factory=list)


def surface_type_name(face: Any) -> str:
    global _SURFACE_NAMES
    from OCC.Core.BRepAdaptor import BRepAdaptor_Surface  # type: ignore
    if _SURFACE_NAMES is None:
        from OCC.Core import GeomAbs  # type: ignore
        _SURFACE_NAMES = {
            GeomAbs.GeomAbs_Plane: "plane", GeomAbs.GeomAbs_Cylinder: "cylinder", GeomAbs.GeomAbs_Cone: "cone",
            GeomAbs.GeomAbs_Sphere: "sphere", GeomAbs.GeomAbs_Torus: "torus",
            GeomAbs.GeomAbs_BezierSurface: "bezier", GeomAbs.GeomAbs_BSplineSurface: "bspline",
            GeomAbs.GeomAbs_SurfaceOfRevolution: "revolution", GeomAbs.GeomAbs_SurfaceOfExtrusion: "extrusion",
            GeomAbs.GeomAbs_OffsetSurface: "offset",
        }
    return _SURFACE_NAMES.get(BRepAdaptor_Surface(face).GetType(), "other")


def exact_face_area(face: Any) -> float:
    from OCC.Core.BRepGProp import brepgprop  # type: ignore
    from OCC.Core.GProp import GProp_GProps  # type: ignore
    props = GProp_GProps()
    brepgprop.SurfaceProperties(face, props)
    return float(props.Mass())


def exact_normal_at(face: Any, point: Vec) -> Optional[Tuple[Vec, Vec]]:
    """(point on the true surface nearest `point`, outward unit normal there), or None where the normal is undefined
    (a cone apex, a sphere pole)."""
    from OCC.Core.BRep import BRep_Tool  # type: ignore
    from OCC.Core.GeomAPI import GeomAPI_ProjectPointOnSurf  # type: ignore
    from OCC.Core.GeomLProp import GeomLProp_SLProps  # type: ignore
    from OCC.Core.TopAbs import TopAbs_REVERSED  # type: ignore
    from OCC.Core.gp import gp_Pnt  # type: ignore
    try:
        surface = BRep_Tool.Surface(face)
        proj = GeomAPI_ProjectPointOnSurf(gp_Pnt(*point), surface)
        if proj.NbPoints() == 0:
            return None
        u, v = proj.LowerDistanceParameters()
        props = GeomLProp_SLProps(surface, u, v, 1, 1e-7)
        if not props.IsNormalDefined():
            return None
        n = props.Normal()
        sign = -1.0 if face.Orientation() == TopAbs_REVERSED else 1.0
        p = proj.NearestPoint()
        return (p.X(), p.Y(), p.Z()), (sign * n.X(), sign * n.Y(), sign * n.Z())
    except Exception:  # OCCT failures surface as RuntimeError (docs/CAD_ENGINE_OCC_BINDING_STANDARDS.md)
        return None


def _systematic(triangles: List[Tuple[float, Any]], k: int) -> List[Any]:
    """k triangles at equal steps of cumulative area (a triangle larger than one step may repeat)."""
    total = sum(a for a, _ in triangles)
    picks, acc, i = [], 0.0, 0
    for j in range(k):
        target = (j + 0.5) * total / k
        while i < len(triangles) - 1 and acc + triangles[i][0] < target:
            acc += triangles[i][0]
            i += 1
        picks.append(triangles[i][1])
    return picks


def sample_face(face: Any, index: int, max_samples: int) -> FaceRecord:
    kind = surface_type_name(face)
    exact = exact_face_area(face)
    tris: List[Tuple[float, Any]] = []
    for t in _face_triangles(face):
        n = _cross(_sub(t[1], t[0]), _sub(t[2], t[0]))
        area = _norm(n) / 2.0
        if area > 1e-12:
            tris.append((area, t))
    rec = FaceRecord(index=index, face=face, surface_type=kind, area_mm2=exact)
    if not tris or exact <= 0.0:
        return rec
    mesh_area = sum(a for a, _ in tris)
    if len(tris) <= max_samples:
        chosen = [(t, exact * a / mesh_area) for a, t in tris]
    else:
        chosen = [(t, exact / max_samples) for t in _systematic(tris, max_samples)]
    for t, weight in chosen:
        centroid = tuple(sum(t[j][i] for j in range(3)) / 3.0 for i in range(3))
        n = _cross(_sub(t[1], t[0]), _sub(t[2], t[0]))
        nl = _norm(n)
        facet_normal = (n[0] / nl, n[1] / nl, n[2] / nl)
        if kind == "plane":  # a plane's facet normal IS its surface normal
            point, normal = centroid, facet_normal
        else:
            hit = exact_normal_at(face, centroid)
            point, normal = hit if hit else (centroid, facet_normal)
        rec.samples.append(SurfaceSample(point=point, normal=normal, weight_mm2=weight))  # type: ignore[arg-type]
    return rec


def sample_shape(shape: Any, linear_deflection: float, max_samples_per_face: int, max_total_samples: Optional[int] = None) -> List[FaceRecord]:
    """Mesh the shape once and sample every face. When the part has so many faces that the cap would exceed
    `max_total_samples`, the per-face cap is lowered (never below 2) so the ray count stays bounded."""
    _ensure_mesh(shape, linear_deflection)
    faces = _faces(shape)
    cap = max_samples_per_face
    if max_total_samples and faces:
        cap = max(2, min(cap, max_total_samples // len(faces)))
    return [sample_face(f, i, cap) for i, f in enumerate(faces)]


def unit(v: Vec) -> Vec:
    n = math.sqrt(v[0] ** 2 + v[1] ** 2 + v[2] ** 2)
    return (v[0] / n, v[1] / n, v[2] / n)
