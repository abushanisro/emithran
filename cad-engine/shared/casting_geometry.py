"""
Casting geometry measurements — shared by every casting process (high
pressure / gravity die casting, sand, investment), measured from the solid
itself, never estimated from the bounding box.

projected_area_mm2
    Area of the part's silhouette on the parting plane (the plane normal to
    the pull axis). Drives clamp force (projected area x cavity pressure) and
    therefore machine selection. Computed as the exact polygon union of every
    tessellated triangle projected onto that plane, so it is correct for
    holes, pockets and overhangs; accuracy is the tessellation's chord
    deflection, not a heuristic.

wall_thickness_profile
    Local wall thickness by the inward ray method: from area-weighted points
    on every face, cast a ray along the inward surface normal and take the
    first exit from the solid. Reports the area-weighted nominal (median),
    min and max. Max governs solidification time; nominal governs flow.
    The ray alone overstates thickness wherever it runs the long way through
    metal (the end face of a rib, boss or solid section: its ray crosses the
    whole length). The nominal (median) and minimum are ray-based; the
    MAXIMUM is the sphere method: the diameter of the largest ball inside
    the metal that touches the surface at the sample (shrinking-ball
    iteration against the exact B-Rep boundary). A ball tangent at a point
    is never longer than that point's ray, so balls are only computed at
    samples whose ray exceeds the largest ball found so far -- exact for the
    maximum without one per sample.
"""
from __future__ import annotations

import logging
import math
from typing import Any, Dict, List, Sequence, Tuple

logger = logging.getLogger(__name__)

# Triangles per face sampled for wall thickness (largest first). Bounds the
# ray-cast count on dense parts; the area weights keep the statistic
# representative of the face, not of how finely it happens to be meshed.
_MAX_SAMPLES_PER_FACE = 12
# Offset (mm) a ray starts inside the surface so it does not re-hit its own face.
_RAY_START_OFFSET_MM = 1e-3


def _ensure_mesh(shape: Any, linear_deflection: float) -> None:
    from OCC.Core.BRepMesh import BRepMesh_IncrementalMesh  # type: ignore
    mesh = BRepMesh_IncrementalMesh(shape, linear_deflection, False, 0.5, True)
    mesh.Perform()


def _face_triangles(face: Any) -> List[Tuple[Tuple[float, float, float], ...]]:
    """World-space triangles of one face, winding flipped for REVERSED faces
    so the triangle normal is the face's outward normal."""
    from OCC.Core.BRep import BRep_Tool  # type: ignore
    from OCC.Core.TopLoc import TopLoc_Location  # type: ignore
    from OCC.Core.TopAbs import TopAbs_REVERSED  # type: ignore

    loc = TopLoc_Location()
    tri = BRep_Tool.Triangulation(face, loc)
    if tri is None:
        return []
    trsf = loc.Transformation()
    reversed_face = face.Orientation() == TopAbs_REVERSED
    out = []
    for i in range(1, tri.NbTriangles() + 1):
        a, b, c = tri.Triangle(i).Get()
        pts = []
        for idx in (a, b, c):
            p = tri.Node(idx).Transformed(trsf)
            pts.append((p.X(), p.Y(), p.Z()))
        if reversed_face:
            pts[1], pts[2] = pts[2], pts[1]
        out.append(tuple(pts))
    return out


def _faces(shape: Any) -> List[Any]:
    from OCC.Core.TopExp import TopExp_Explorer  # type: ignore
    from OCC.Core.TopAbs import TopAbs_FACE  # type: ignore
    from OCC.Core.TopoDS import topods  # type: ignore
    faces = []
    exp = TopExp_Explorer(shape, TopAbs_FACE)
    while exp.More():
        faces.append(topods.Face(exp.Current()))
        exp.Next()
    return faces


def _sub(a, b):
    return (a[0] - b[0], a[1] - b[1], a[2] - b[2])


def _cross(a, b):
    return (a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0])


def _dot(a, b):
    return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]


def _norm(a):
    return math.sqrt(_dot(a, a))


def _plane_basis(axis: Sequence[float]) -> Tuple[Tuple[float, float, float], Tuple[float, float, float]]:
    n = tuple(float(x) for x in axis)
    length = _norm(n)
    if length == 0:
        raise ValueError("pull axis has zero length")
    n = (n[0] / length, n[1] / length, n[2] / length)
    helper = (1.0, 0.0, 0.0) if abs(n[0]) < 0.9 else (0.0, 1.0, 0.0)
    u = _cross(n, helper)
    u = tuple(x / _norm(u) for x in u)
    v = _cross(n, u)
    return u, v  # type: ignore[return-value]


def parting_plane_silhouette(shape: Any, pull_axis: Sequence[float], linear_deflection: float = 0.1) -> Dict[str, Any]:
    """The part's silhouette on the plane normal to pull_axis: its exact area
    (mm^2), the extents of that silhouette along the plane's two in-plane
    axes (mm) -- the footprint a die has to straddle between the tie bars --
    and the part's extent along the pull axis itself (mm), the depth the die
    halves have to enclose. parting_perimeter_mm is the length of the
    silhouette's outer boundary: the parting line, where flash forms between
    the die halves (inner boundaries -- through-openings -- are not counted)."""
    from shapely.geometry import Polygon  # type: ignore
    from shapely.ops import unary_union  # type: ignore

    _ensure_mesh(shape, linear_deflection)
    u, v = _plane_basis(pull_axis)
    n = tuple(float(x) for x in pull_axis)
    n_len = _norm(n)
    n = (n[0] / n_len, n[1] / n_len, n[2] / n_len)
    polys = []
    depth_lo, depth_hi = math.inf, -math.inf
    for face in _faces(shape):
        for t in _face_triangles(face):
            for p in t:
                d = _dot(p, n)
                depth_lo, depth_hi = min(depth_lo, d), max(depth_hi, d)
            pts2 = [(_dot(p, u), _dot(p, v)) for p in t]
            poly = Polygon(pts2)
            # Triangles edge-on to the projection plane have no area to add.
            if poly.area > 1e-9:
                polys.append(poly)
    if not polys:
        return {"area_mm2": 0.0, "footprint_mm": [0.0, 0.0], "pull_extent_mm": 0.0, "parting_perimeter_mm": 0.0}
    union = unary_union(polys)
    minx, miny, maxx, maxy = union.bounds
    parts = list(union.geoms) if hasattr(union, "geoms") else [union]
    perimeter = sum(p.exterior.length for p in parts if hasattr(p, "exterior"))
    return {
        "area_mm2": float(union.area),
        "footprint_mm": [float(maxx - minx), float(maxy - miny)],
        "pull_extent_mm": float(depth_hi - depth_lo),
        "parting_perimeter_mm": float(perimeter),
    }


def projected_area_mm2(shape: Any, pull_axis: Sequence[float], linear_deflection: float = 0.1) -> float:
    """Exact silhouette area on the plane normal to pull_axis (mm^2)."""
    return parting_plane_silhouette(shape, pull_axis, linear_deflection)["area_mm2"]


def wall_thickness_profile(shape: Any, linear_deflection: float = 0.1) -> Dict[str, Any]:
    """Area-weighted local wall thickness from inward ray casts (mm)."""
    from OCC.Core.IntCurvesFace import IntCurvesFace_ShapeIntersector  # type: ignore
    from OCC.Core.gp import gp_Pnt, gp_Dir, gp_Lin  # type: ignore

    _ensure_mesh(shape, linear_deflection)
    intersector = IntCurvesFace_ShapeIntersector()
    intersector.Load(shape, 1e-6)

    samples: List[Tuple[float, float]] = []  # (thickness_mm, weight_mm2)
    rays: List[Tuple[float, Tuple[float, float, float], Tuple[float, float, float]]] = []  # (ray mm, point, inward)
    for face in _faces(shape):
        tris = []
        for t in _face_triangles(face):
            n = _cross(_sub(t[1], t[0]), _sub(t[2], t[0]))
            area2 = _norm(n)
            if area2 > 1e-12:
                tris.append((area2 / 2.0, t, n))
        tris.sort(key=lambda x: x[0], reverse=True)
        for area, t, n in tris[:_MAX_SAMPLES_PER_FACE]:
            inward = tuple(-x / (2.0 * area) for x in n)
            c = tuple((t[0][i] + t[1][i] + t[2][i]) / 3.0 for i in range(3))
            start = tuple(c[i] + inward[i] * _RAY_START_OFFSET_MM for i in range(3))
            intersector.Perform(gp_Lin(gp_Pnt(*start), gp_Dir(*inward)), 0.0, 1e9)
            if not intersector.IsDone() or intersector.NbPnt() == 0:
                continue
            hit = min(intersector.WParameter(i) for i in range(1, intersector.NbPnt() + 1))
            samples.append((hit + _RAY_START_OFFSET_MM, area))
            rays.append((hit + _RAY_START_OFFSET_MM, c, inward))

    if not samples:
        return {
            "wall_thickness_nominal_mm": None, "wall_thickness_min_mm": None,
            "wall_thickness_max_mm": None, "wall_thickness_sample_count": 0,
            "wall_thickness_method": "inward_ray",
        }

    samples.sort(key=lambda s: s[0])
    max_wall, max_method = _thickest_wall_by_sphere(shape, rays)
    total = sum(w for _, w in samples)
    acc = 0.0
    nominal = samples[-1][0]
    for t, w in samples:
        acc += w
        if acc >= total / 2.0:
            nominal = t
            break
    return {
        "wall_thickness_nominal_mm": round(nominal, 3),
        "wall_thickness_min_mm": round(samples[0][0], 3),
        "wall_thickness_max_mm": round(max_wall, 3),
        "wall_thickness_max_method": max_method,
        "wall_thickness_sample_count": len(samples),
        "wall_thickness_method": "inward_ray",
    }


def _thickest_wall_by_sphere(shape: Any, rays) -> Tuple[float, str]:
    """Largest inscribed-ball diameter over the ray samples (see wall_thickness_profile)."""
    from OCC.Core.BRep import BRep_Builder  # type: ignore
    from OCC.Core.BRepBuilderAPI import BRepBuilderAPI_MakeVertex  # type: ignore
    from OCC.Core.BRepExtrema import BRepExtrema_DistShapeShape  # type: ignore
    from OCC.Core.TopoDS import TopoDS_Compound  # type: ignore
    from OCC.Core.gp import gp_Pnt  # type: ignore

    boundary = TopoDS_Compound()
    builder = BRep_Builder()
    builder.MakeCompound(boundary)
    for f in _faces(shape):
        builder.Add(boundary, f)

    def nearest(c):
        d = BRepExtrema_DistShapeShape(BRepBuilderAPI_MakeVertex(gp_Pnt(*c)).Vertex(), boundary)
        if not d.IsDone() or d.NbSolution() == 0:
            return None
        q = d.PointOnShape2(1)
        return d.Value(), (q.X(), q.Y(), q.Z())

    best = 0.0
    for ray, p, n in sorted(rays, key=lambda r: r[0], reverse=True):
        if ray <= best:
            break
        r = ray / 2.0
        for _ in range(60):
            c = tuple(p[i] + r * n[i] for i in range(3))
            hit = nearest(c)
            if hit is None:
                break
            s, q = hit
            if s >= r - max(1e-4, 1e-4 * r):
                break  # the ball fits
            pq = _sub(q, p)
            denom = 2.0 * _dot(n, pq)
            if denom <= 1e-12:
                break
            # The ball tangent at p through q; strictly shrinks.
            r = min(_dot(pq, pq) / denom, r * (1 - 1e-6))
        best = max(best, 2.0 * r)
    return best, "inscribed_sphere"
