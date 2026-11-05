"""
The mold-opening (pull) direction, found from every surface of the part, or supplied by the engineer.

A pull direction is an axis (it has no sign: the mold opens both ways). For a candidate axis d, a surface facing +d must be reachable from the +d half of
the mold, so nothing may lie above it along d; a surface facing -d must be reachable from the -d half. A surface that is covered is an undercut: it
needs a side core, a lifter or a slide. The direction chosen is the candidate with the least undercut area (the most releasable part); of equal
candidates, the one with the larger projected area (the large open face is the parting side). The old analysis snapped the axis to X, Y or Z from the
planar-face area; this one considers axes and the part's own dominant face directions, and counts free-form surfaces too.

Visibility is a depth buffer over the plane perpendicular to d, filled from points sampled on every triangle (so a large flat lid, which is two
triangles, still covers what lies under it).
"""
from __future__ import annotations

import math
from dataclasses import dataclass
from typing import Dict, List, Optional, Sequence, Tuple

from .mesh import FaceMesh, Triangle
from .vec import Vec, angle_between_axes_deg, canonical, cross, dot, unit

GRID = 96
AXES: Tuple[Vec, ...] = ((1.0, 0.0, 0.0), (0.0, 1.0, 0.0), (0.0, 0.0, 1.0))
_dot, _cross = dot, cross


def candidate_directions(meshes: Sequence[FaceMesh], max_clusters: int = 6, dedupe_deg: float = 2.0) -> List[Vec]:
    """The three axes plus the directions most of the surface area faces (normals bucketed by direction, heaviest first)."""
    buckets: Dict[Tuple[int, int, int], List[float]] = {}
    for f in meshes:
        for t in f.triangles:
            n = canonical(t.normal)
            key = (round(n[0] / 0.03), round(n[1] / 0.03), round(n[2] / 0.03))
            b = buckets.setdefault(key, [0.0, 0.0, 0.0, 0.0])
            b[0] += n[0] * t.area
            b[1] += n[1] * t.area
            b[2] += n[2] * t.area
            b[3] += t.area
    heaviest = sorted(buckets.values(), key=lambda b: -b[3])[:max_clusters]
    found: List[Vec] = list(AXES)
    for b in heaviest:
        try:
            d = canonical((b[0], b[1], b[2]))
        except ValueError:
            continue
        if all(angle_between_axes_deg(d, e) > dedupe_deg for e in found):
            found.append(d)
    return found


def _basis(d: Vec) -> Tuple[Vec, Vec]:
    a = (1.0, 0.0, 0.0) if abs(d[0]) < 0.9 else (0.0, 1.0, 0.0)
    e1 = unit(_cross(d, a))
    return e1, _cross(d, e1)


def undercut_flags(meshes: Sequence[FaceMesh], d: Vec, undrafted_deg: float, grid: int = GRID) -> Dict[int, List[bool]]:
    """
    For each face index, one flag per triangle: True when that triangle is an undercut along axis d (covered from the side it faces).
    A triangle whose normal is within `undrafted_deg` of perpendicular to d is a side wall, never an undercut.
    """
    d = unit(d)
    e1, e2 = _basis(d)
    tris: List[Tuple[int, Triangle]] = [(f.index, t) for f in meshes for t in f.triangles]
    if not tris:
        return {f.index: [] for f in meshes}
    cu = [_dot(t.centroid, e1) for _, t in tris]
    cv = [_dot(t.centroid, e2) for _, t in tris]
    u_min, u_max, v_min, v_max = min(cu), max(cu), min(cv), max(cv)
    cell = max(u_max - u_min, v_max - v_min, 1e-6) / grid
    top: Dict[Tuple[int, int], float] = {}
    bottom: Dict[Tuple[int, int], float] = {}

    def key(u: float, v: float) -> Tuple[int, int]:
        return (math.floor((u - u_min) / cell), math.floor((v - v_min) / cell))

    # Fill the buffer from points spread over every triangle, spaced about one cell apart (a vertex, an edge point and an interior point all count).
    for _, t in tris:
        p, q, r = t.vertices
        longest = max(math.dist(p, q), math.dist(q, r), math.dist(r, p))
        n = max(1, int(math.ceil(longest / cell)))
        # The centroid is always sampled: it is the point each triangle is judged at.
        k = key(_dot(t.centroid, e1), _dot(t.centroid, e2))
        hc = _dot(t.centroid, d)
        if k not in top or hc > top[k]:
            top[k] = hc
        if k not in bottom or hc < bottom[k]:
            bottom[k] = hc
        for i in range(n + 1):
            for j in range(n + 1 - i):
                wq, wr = i / n, j / n
                wp = 1.0 - wq - wr
                point = (wp * p[0] + wq * q[0] + wr * r[0], wp * p[1] + wq * q[1] + wr * r[1], wp * p[2] + wq * q[2] + wr * r[2])
                u, v, h = _dot(point, e1), _dot(point, e2), _dot(point, d)
                k = key(u, v)
                if k not in top or h > top[k]:
                    top[k] = h
                if k not in bottom or h < bottom[k]:
                    bottom[k] = h

    eps = math.sin(math.radians(undrafted_deg))
    out: Dict[int, List[bool]] = {f.index: [] for f in meshes}
    for (index, t), u, v in zip(tris, cu, cv):
        dot = _dot(t.normal, d)
        covered = False
        if abs(dot) > eps:
            h = _dot(t.centroid, d)
            k = key(u, v)
            # A sloped surface changes height across its own cell: only cover beyond that (plus two cells of slack) is an undercut.
            slope = cell * math.sqrt(max(0.0, 1.0 - dot * dot)) / abs(dot)
            tol = 2.0 * cell + 1.5 * slope
            covered = (h < top[k] - tol) if dot > 0 else (h > bottom[k] + tol)
        out[index].append(covered)
    return out


@dataclass(frozen=True)
class DirectionScore:
    direction: Vec
    undercut_area_mm2: float
    projected_area_mm2: float


def score_direction(meshes: Sequence[FaceMesh], d: Vec, undrafted_deg: float) -> DirectionScore:
    flags = undercut_flags(meshes, d, undrafted_deg)
    d = unit(d)
    undercut = 0.0
    projected = 0.0
    for f in meshes:
        for t, covered in zip(f.triangles, flags[f.index]):
            if covered:
                undercut += t.area
            projected += abs(_dot(t.normal, d)) * t.area
    return DirectionScore(direction=canonical(d), undercut_area_mm2=undercut, projected_area_mm2=projected / 2.0)


@dataclass(frozen=True)
class PullDirection:
    vector: Vec
    source: str  # 'auto' | 'override'
    undercut_area_mm2: float
    projected_area_mm2: float
    alternatives: List[DirectionScore]

    def nearest_axis(self, within_deg: float = 5.0) -> Optional[str]:
        for name, axis in zip("xyz", AXES):
            if angle_between_axes_deg(self.vector, axis) <= within_deg:
                return name
        return None


def choose_pull_direction(
    meshes: Sequence[FaceMesh], undrafted_deg: float, override: Optional[Vec] = None, tie_area_mm2: float = 1.0,
) -> PullDirection:
    """The override when the engineer gave one (it is still measured, so the cost view can show what it implies); else the best candidate."""
    scores = [score_direction(meshes, d, undrafted_deg) for d in candidate_directions(meshes)]
    if override is not None:
        chosen = score_direction(meshes, override, undrafted_deg)
        return PullDirection(chosen.direction, "override", chosen.undercut_area_mm2, chosen.projected_area_mm2, scores)
    best = min(scores, key=lambda s: s.undercut_area_mm2)
    # Of the candidates within a square millimetre of the least undercut, the one with the larger projected area.
    near = [s for s in scores if s.undercut_area_mm2 <= best.undercut_area_mm2 + tie_area_mm2]
    chosen = max(near, key=lambda s: s.projected_area_mm2)
    others = [s for s in scores if s is not chosen]
    return PullDirection(chosen.direction, "auto", chosen.undercut_area_mm2, chosen.projected_area_mm2, others)
