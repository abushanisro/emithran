"""
How each machined feature is reached and what surrounds it: three measurements added to every feature_graph_v2
occurrence, from the faces the occurrence names.

  tool_axis, tool_axis_bidirectional
      The unit approach vector, from the material toward the spindle (the contract the backend's setup rule reads,
      setup-axis-rule.ts). A hole: its cylinder axis, out of its open end; reachable from either end when both are
      open. A pocket: the outward normal of its floor. A cutout: its wall axis, from either side. A feature with no
      single approach (a surface region, an edge blend) gets none.
  corner_radius_mm
      A pocket's tightest internal corner: the smallest concave cylinder that stands on the pocket floor with its
      axis along the floor normal; 0 where two walls meet in a sharp inside edge standing on the floor (a rotating
      cutter cannot make it). The cutter that finishes the pocket can be no larger. A pocket with neither (an open
      step) gets none.
  min_wall_mm
      The thinnest material behind the occurrence's faces (the largest inscribed ball touching each face, the same
      measurement the molded-part analysis uses), so a thin web or a hole close to an edge is located on a feature.

All three are read from the tessellation of the shape (one mesh, every face kind alike). A measurement that cannot be
made is left out, never guessed.
"""
from __future__ import annotations

import logging
from typing import Any, Dict, Iterable, List, Optional, Sequence, Tuple

import numpy as np

from injection_molding.recognition.mesh import FaceMesh, tessellate_faces
from injection_molding.recognition.wall_thickness import measure_wall_thickness

logger = logging.getLogger(__name__)

_HOLES = ("SimpleHole", "MultiStepHole")
_PARALLEL = 0.999          # |cos| above which two directions are the same line
_CORNER_MAX_SWEEP = 3.3    # rad: a corner arc is up to a half turn (an obround end); a full turn is a round pocket's own wall


def _unit(v: Sequence[float]) -> Optional[np.ndarray]:
    a = np.asarray(v, dtype=np.float64)
    n = float(np.linalg.norm(a))
    return a / n if n > 1e-12 else None


def _rounded(v: np.ndarray) -> List[float]:
    return [round(float(c) + 0.0, 4) for c in v]


class _Mesh:
    """Every triangle of the part, for ray casts and plane tests."""

    def __init__(self, meshes: Sequence[FaceMesh]):
        tris = [t for f in meshes for t in f.triangles]
        self.v0 = np.asarray([t.vertices[0] for t in tris], dtype=np.float64).reshape(-1, 3)
        self.e1 = np.asarray([t.vertices[1] for t in tris], dtype=np.float64).reshape(-1, 3) - self.v0
        self.e2 = np.asarray([t.vertices[2] for t in tris], dtype=np.float64).reshape(-1, 3) - self.v0

    def first_hit(self, origin: np.ndarray, direction: np.ndarray) -> float:
        """Distance along the ray to the nearest triangle (Moller-Trumbore), or inf when it leaves the part without meeting one."""
        if len(self.v0) == 0:
            return float("inf")
        p = np.cross(direction, self.e2)
        det = np.einsum("nj,nj->n", self.e1, p)
        ok = np.abs(det) > 1e-12
        inv = np.where(ok, 1.0 / np.where(ok, det, 1.0), 0.0)
        s = origin - self.v0
        u = np.einsum("nj,nj->n", s, p) * inv
        q = np.cross(s, self.e1)
        v = (q @ direction) * inv
        t = np.einsum("nj,nj->n", self.e2, q) * inv
        hit = ok & (u >= -1e-9) & (v >= -1e-9) & (u + v <= 1 + 1e-9) & (t > 1e-6)
        return float(t[hit].min()) if hit.any() else float("inf")


def _vertices(face: FaceMesh) -> np.ndarray:
    return np.asarray([v for t in face.triangles for v in t.vertices], dtype=np.float64).reshape(-1, 3)


def _hole_axis(faces: Sequence[FaceMesh], mesh: _Mesh) -> Optional[Tuple[np.ndarray, bool]]:
    """The approach vector of a hole and whether it is open at both ends, from its largest cylinder wall."""
    walls = [f for f in faces if f.surface == "cylinder" and f.revolved is not None and f.triangles]
    if not walls:
        return None
    wall = max(walls, key=lambda f: f.area)
    axis = _unit(wall.revolved.axis)
    if axis is None:
        return None
    point = np.asarray(wall.revolved.axis_point, dtype=np.float64)
    radius = float(wall.revolved.radius)
    # The hole's reach along its axis is that of all its coaxial walls (a counterbore's two steps are one hole).
    along = np.concatenate([(_vertices(f) - point) @ axis for f in walls
                            if abs(float(np.dot(_unit(f.revolved.axis), axis))) > _PARALLEL])
    lo, hi = float(along.min()), float(along.max())
    middle = point + axis * ((lo + hi) / 2.0)
    half = (hi - lo) / 2.0
    # An end is closed when the axis meets material within the hole's own length plus a drill point (at most one radius deep).
    reach = half + radius + 1e-3
    closed_plus = mesh.first_hit(middle, axis) <= reach
    closed_minus = mesh.first_hit(middle, -axis) <= reach
    if closed_plus and closed_minus:
        return None
    if not closed_plus and not closed_minus:
        return axis, True
    return (-axis if closed_plus else axis), False


def _floor(faces: Sequence[FaceMesh]) -> Optional[Tuple[np.ndarray, float, FaceMesh]]:
    """A pocket's floor: its largest planar face, with the outward normal and the plane's offset along it."""
    planes = [f for f in faces if f.surface == "plane" and f.triangles]
    if not planes:
        return None
    floor = max(planes, key=lambda f: f.area)
    normal = _unit(np.sum([np.asarray(t.normal) * t.area for t in floor.triangles], axis=0))
    if normal is None:
        return None
    offset = float(np.mean(_vertices(floor) @ normal))
    return normal, offset, floor


def _corner_radius(floor: Tuple[np.ndarray, float, FaceMesh], meshes: Sequence[FaceMesh], tol: float) -> Optional[float]:
    """The smallest concave cylinder standing on the floor with its axis along the floor normal."""
    normal, offset, floor_face = floor
    floor_pts = _vertices(floor_face)
    lo, hi = floor_pts.min(axis=0) - tol, floor_pts.max(axis=0) + tol
    best: Optional[float] = None
    for f in meshes:
        if f.surface != "cylinder" or f.revolved is None or not f.triangles or f.index == floor_face.index:
            continue
        axis = _unit(f.revolved.axis)
        if axis is None or abs(float(np.dot(axis, normal))) < _PARALLEL:
            continue
        radius = float(f.revolved.radius)
        pts = _vertices(f)
        heights = pts @ normal - offset
        # It stands on the floor: it starts at the floor plane and rises out of the material side of it.
        if abs(float(heights.min())) > tol or float(heights.max()) < tol * 2:
            continue
        foot = pts[np.abs(heights) <= tol]
        if not np.all((foot >= lo) & (foot <= hi)):
            continue
        # Concave: the wall's outward normal (out of the material) points toward its own axis.
        point = np.asarray(f.revolved.axis_point, dtype=np.float64)
        toward_axis = 0.0
        for t in f.triangles:
            radial = np.asarray(t.centroid) - point
            radial = radial - axis * float(np.dot(radial, axis))
            toward_axis += -float(np.dot(np.asarray(t.normal), radial)) * t.area
        if toward_axis <= 0:
            continue
        height = float(heights.max() - heights.min())
        if height <= 0 or f.area / (radius * height) > _CORNER_MAX_SWEEP:
            continue
        best = radius if best is None else min(best, radius)
    return best


def _has_sharp_corner(floor: Tuple[np.ndarray, float, FaceMesh], by_id: Dict[int, FaceMesh], sharp_edges: Sequence[Dict[str, Any]], tol: float) -> bool:
    """True when a sharp inside edge between two walls stands on the floor: it runs along the floor normal from the floor plane up."""
    normal, offset, floor_face = floor
    pts = _vertices(floor_face)
    lo, hi = pts.min(axis=0) - tol, pts.max(axis=0) + tol
    for edge in sharp_edges:
        if edge.get("concavity") != "internal" or not edge.get("midpoint_mm"):
            continue
        walls = [by_id.get(i) for i in edge.get("face_ids") or []]
        if len(walls) != 2 or any(w is None or w.surface != "plane" or not w.triangles or w.index == floor_face.index for w in walls):
            continue
        # Both faces are walls of this floor: their normals are square to the floor normal.
        if any(abs(float(np.dot(np.asarray(w.triangles[0].normal), normal))) > 1e-3 for w in walls):
            continue
        middle = np.asarray(edge["midpoint_mm"], dtype=np.float64)
        height = float(middle @ normal) - offset
        # A straight edge along the normal that starts on the floor has its middle half its length above it.
        if abs(height - float(edge["length_mm"]) / 2.0) > tol:
            continue
        foot = middle - normal * height
        if np.all((foot >= lo) & (foot <= hi)):
            return True
    return False


def annotate_access_from_meshes(
    meshes: Sequence[FaceMesh], features: Iterable[Dict[str, Any]], resolution_mm: float,
    sharp_edges: Optional[Sequence[Dict[str, Any]]] = None,
) -> None:
    """
    Add tool_axis, corner_radius_mm and min_wall_mm to the occurrences of feature_graph_v2 entries, in place.
    `sharp_edges` are shared.edge_length.sharp_edge_length(detail=True, concavity=True)["edges"]; without them a sharp corner is not looked for.
    """
    by_id = {f.index: f for f in meshes}
    mesh = _Mesh(meshes)
    # A face's thickness is the largest ball that touches it (the wall behind it), not its smallest sample at an edge.
    wall = {f["face_id"]: f["thickness_mm"] for f in measure_wall_thickness(meshes, resolution_mm)["faces"]}
    tol = max(0.05, resolution_mm)
    for group in features:
        ftype = group.get("feature_type")
        for occ in group.get("occurrences", []) or []:
            faces = [by_id[i] for i in (occ.get("face_ids") or []) if i in by_id]
            if not faces:
                continue
            behind = [wall[f.index] for f in faces if f.index in wall]
            if behind:
                occ["min_wall_mm"] = round(min(behind), 3)
            if ftype in _HOLES or ftype == "Cutout":
                found = _hole_axis(faces, mesh)
                if found is not None:
                    axis, both = found
                    occ["tool_axis"] = _rounded(axis)
                    occ["tool_axis_bidirectional"] = bool(both or ftype == "Cutout")
            elif ftype == "PocketV2":
                floor = _floor(faces)
                if floor is not None:
                    occ["tool_axis"] = _rounded(floor[0])
                    occ["tool_axis_bidirectional"] = False
                    radius = 0.0 if sharp_edges and _has_sharp_corner(floor, by_id, sharp_edges, tol) else _corner_radius(floor, meshes, tol)
                    if radius is not None:
                        occ["corner_radius_mm"] = round(radius, 3)


def annotate_occurrence_access(shape: Any, features: Iterable[Dict[str, Any]], bbox_dims: Sequence[float]) -> bool:
    """The same, from the shape (True when measured): tessellated at the deflection the molded-part analysis uses (a thousandth of the diagonal, at least 0.1 mm)."""
    diagonal = float(np.sqrt(sum(float(x) ** 2 for x in bbox_dims)))
    resolution = max(0.1, diagonal * 0.001)
    try:
        meshes = tessellate_faces(shape, linear_deflection=resolution)
    except Exception as e:  # pragma: no cover - only on a shape that cannot be meshed
        logger.warning(f"[feature_access] tessellation failed: {e}")
        return False
    sharp_edges = None
    try:
        from shared.edge_length import sharp_edge_length
        sharp_edges = sharp_edge_length(shape, detail=True, concavity=True).get("edges")
    except Exception as e:  # pragma: no cover - only on a shape whose edges cannot be classified
        logger.warning(f"[feature_access] sharp edges not classified: {e}")
    annotate_access_from_meshes(meshes, features, resolution, sharp_edges)
    return True
