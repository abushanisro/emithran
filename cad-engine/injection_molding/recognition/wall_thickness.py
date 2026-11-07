"""
Wall thickness at every face: the diameter of the largest ball that fits inside the material and touches the surface at a sample point on the face. A thin zone is where
that is small, a thick section where it is large, and both are located: the thickness belongs to a face.

Why a ball and not just a ray along the inward normal: from the end face of a wall (a rim top) that ray runs the length of the wall and reports its height, not its
thickness. The ball starts as the one the ray gives (centre half way to the first surface it leaves the material through) and shrinks until nothing else touches it
(the shrinking-ball algorithm), so the end of a 2.5 mm wall reads 2.5 mm however tall the wall is.

The nominal wall of the part comes from the antiparallel flat faces (a few of them on a curved cover); this measures every face, curved ones included, from the same mesh
the draft and undercut analyses use. The mesh is a tessellation, so a thickness is good to about the deflection the mesh was cut at (reported as `resolution_mm`); the
rules that read it judge limits far above that.

A ray that leaves through no surface (an open or broken mesh) gives no thickness for that sample, and a face none of whose samples gave one is left out: it is never
given a guessed number.
"""
from __future__ import annotations

from typing import Any, Dict, List, Sequence, Tuple

import numpy as np

from .mesh import FaceMesh

# The ray starts this far inside the material so it does not meet the triangle it leaves; a hit nearer than the same distance is that triangle's own neighbour edge.
_START_INSIDE_MM = 1e-3
_MIN_HIT_MM = 1e-3
# Most rays to cast for the whole part, and the most (ray x triangle) tests to spend on them: a larger mesh gets fewer samples per face, never a truncated face list.
_MAX_RAYS = 6000
_WORK_BUDGET = 6e8
_MAX_SAMPLES_PER_FACE = 8
_CHUNK = 24
_MAX_SHRINKS = 8


def _closest_distance_sq(c: np.ndarray, V0: np.ndarray, E1: np.ndarray, E2: np.ndarray) -> Tuple[np.ndarray, np.ndarray]:
    """Closest point on each triangle (V0, V0+E1, V0+E2) to the point c, and the squared distance to it (Ericson, Real-Time Collision Detection 5.1.5)."""
    a = V0
    ap = c[None, :] - a
    d1 = np.einsum("nj,nj->n", E1, ap)
    d2 = np.einsum("nj,nj->n", E2, ap)
    bp = ap - E1
    d3 = np.einsum("nj,nj->n", E1, bp)
    d4 = np.einsum("nj,nj->n", E2, bp)
    cp = ap - E2
    d5 = np.einsum("nj,nj->n", E1, cp)
    d6 = np.einsum("nj,nj->n", E2, cp)
    vc = d1 * d4 - d3 * d2
    vb = d5 * d2 - d1 * d6
    va = d3 * d6 - d5 * d4
    with np.errstate(divide="ignore", invalid="ignore"):
        # barycentric (v, w) of the closest point, by region
        v = np.zeros_like(d1)
        w = np.zeros_like(d1)
        reg_a = (d1 <= 0) & (d2 <= 0)
        reg_b = (d3 >= 0) & (d4 <= d3)
        reg_c = (d6 >= 0) & (d5 <= d6)
        reg_ab = (vc <= 0) & (d1 >= 0) & (d3 <= 0)
        reg_ac = (vb <= 0) & (d2 >= 0) & (d6 <= 0)
        reg_bc = (va <= 0) & ((d4 - d3) >= 0) & ((d5 - d6) >= 0)
        denom = 1.0 / (va + vb + vc)
        v_in, w_in = vb * denom, vc * denom
        v_ab = d1 / (d1 - d3)
        w_ac = d2 / (d2 - d6)
        w_bc = (d4 - d3) / ((d4 - d3) + (d5 - d6))
        v = np.where(reg_ab, v_ab, v)
        w = np.where(reg_ac, w_ac, w)
        v = np.where(reg_bc, 1.0 - w_bc, v)
        w = np.where(reg_bc, w_bc, w)
        interior = ~(reg_a | reg_b | reg_c | reg_ab | reg_ac | reg_bc)
        v = np.where(interior, v_in, v)
        w = np.where(interior, w_in, w)
        v = np.where(reg_b, 1.0, v)
        w = np.where(reg_b, 0.0, w)
        v = np.where(reg_c, 0.0, v)
        w = np.where(reg_c, 1.0, w)
    q = a + E1 * v[:, None] + E2 * w[:, None]
    diff = q - c[None, :]
    return np.einsum("nj,nj->n", diff, diff), q


def _shrink_ball(p: np.ndarray, n: np.ndarray, radius: float, V0: np.ndarray, E1: np.ndarray, E2: np.ndarray, tri_min: np.ndarray, tri_max: np.ndarray) -> float:
    """
    The radius of the largest ball inside the material that touches the surface at p (outward normal n), starting from `radius` (the ball the inward ray gives): while some
    surface point is nearer to the centre than the radius, the ball is moved down the normal until it touches that point too.
    """
    for _ in range(_MAX_SHRINKS):
        c = p - n * radius
        near = np.nonzero(np.all((tri_min <= c + radius) & (tri_max >= c - radius), axis=1))[0]
        if near.size == 0:
            break
        d2, q = _closest_distance_sq(c, V0[near], E1[near], E2[near])
        j = int(np.argmin(d2))
        if d2[j] >= (radius * (1.0 - 1e-3)) ** 2:
            break
        pq = p - q[j]
        denom = 2.0 * float(np.dot(n, pq))
        if denom <= 1e-9:
            break
        shrunk = float(np.dot(pq, pq)) / denom
        if not (0.0 < shrunk < radius):
            break
        radius = shrunk
    return radius


def _area_centroid_on_face(face: FaceMesh, offset: int, V0: np.ndarray, E1: np.ndarray, E2: np.ndarray):
    """The area centroid of a planar face and the triangle it lies in, or None when it lies in no triangle (a ring around a hole has its centroid in the hole)."""
    total = sum(t.area for t in face.triangles)
    if total <= 0:
        return None
    c = np.asarray([sum(t.centroid[k] * t.area for t in face.triangles) / total for k in range(3)])
    for i in range(len(face.triangles)):
        g = offset + i
        a, b, cc = V0[g], V0[g] + E1[g], V0[g] + E2[g]
        v0, v1, v2 = E1[g], E2[g], c - a
        d00, d01, d11, d20, d21 = v0 @ v0, v0 @ v1, v1 @ v1, v2 @ v0, v2 @ v1
        den = d00 * d11 - d01 * d01
        if abs(den) < 1e-18:
            continue
        v = (d11 * d20 - d01 * d21) / den
        w = (d00 * d21 - d01 * d20) / den
        if v >= -1e-9 and w >= -1e-9 and v + w <= 1 + 1e-9:
            return g, (float(c[0]), float(c[1]), float(c[2]))
    return None


def _samples(face: FaceMesh, k: int) -> List[int]:
    """Up to k triangles of the face: the largest first, then others spread along the face's triangle order, so a long curved face is not sampled at one end only."""
    n = len(face.triangles)
    if n <= k:
        return list(range(n))
    by_area = sorted(range(n), key=lambda i: -face.triangles[i].area)
    chosen = [by_area[0]]
    stride = max(1, n // k)
    for i in range(0, n, stride):
        if len(chosen) >= k:
            break
        if i not in chosen:
            chosen.append(i)
    return chosen


def measure_wall_thickness(meshes: Sequence[FaceMesh], resolution_mm: float) -> Dict[str, Any]:
    tri_face: List[int] = []
    v0: List[Tuple[float, float, float]] = []
    e1: List[Tuple[float, float, float]] = []
    e2: List[Tuple[float, float, float]] = []
    nrm: List[Tuple[float, float, float]] = []
    for f in meshes:
        for t in f.triangles:
            a, b, c = t.vertices
            v0.append(a)
            e1.append((b[0] - a[0], b[1] - a[1], b[2] - a[2]))
            e2.append((c[0] - a[0], c[1] - a[1], c[2] - a[2]))
            nrm.append(t.normal)
            tri_face.append(f.index)
    n_tri = len(v0)
    if n_tri == 0:
        return {"method": "inward ray to the first exit", "resolution_mm": resolution_mm, "rays": 0, "missed": 0, "faces": []}
    V0, E1, E2, N = (np.asarray(x, dtype=np.float64) for x in (v0, e1, e2, nrm))
    corners = np.stack([V0, V0 + E1, V0 + E2])
    tri_min, tri_max = corners.min(axis=0), corners.max(axis=0)

    # Where each ray starts: a sampled triangle's centroid, and on a planar face the face's own area centroid too (when it lies on the face). A narrow strip (the end of a
    # wall) is measured at its middle that way: a ball touching an off-centre point of a strip is smaller than the strip is wide.
    ray_face: List[int] = []
    ray_p: List[Tuple[float, float, float]] = []
    ray_n: List[Tuple[float, float, float]] = []
    ray_tri: List[int] = []
    offsets: Dict[int, int] = {}
    cursor = 0
    for f in meshes:
        offsets[f.index] = cursor
        cursor += len(f.triangles)
    populated = [f for f in meshes if f.triangles]
    per_face = max(1, min(_MAX_SAMPLES_PER_FACE, _MAX_RAYS // (4 * max(1, len(populated)))))
    per_face = max(1, min(per_face, int(_WORK_BUDGET // max(1, n_tri)) // (4 * max(1, len(populated)))))
    for f in populated:
        for i in _samples(f, per_face):
            g = offsets[f.index] + i
            ray_face.append(f.index)
            ray_p.append(tuple(V0[g] + (E1[g] + E2[g]) / 3.0))  # type: ignore[arg-type]
            ray_n.append(tuple(N[g]))  # type: ignore[arg-type]
            ray_tri.append(g)
        if f.surface == "plane":
            # The midpoints of a sampled triangle's edges as well: a strip (the end of a wall, a ring) is cut into triangles by diagonals, and a diagonal's midpoint is on the
            # strip's centre line, where a ball touching the face is as large as the wall is thick. A midpoint on the face's boundary reads smaller and loses to it.
            for i in _samples(f, per_face):
                g = offsets[f.index] + i
                for mid in (V0[g] + E1[g] / 2.0, V0[g] + E2[g] / 2.0, V0[g] + (E1[g] + E2[g]) / 2.0):
                    ray_face.append(f.index)
                    ray_p.append((float(mid[0]), float(mid[1]), float(mid[2])))
                    ray_n.append((float(N[g][0]), float(N[g][1]), float(N[g][2])))
                    ray_tri.append(g)
            hit = _area_centroid_on_face(f, offsets[f.index], V0, E1, E2)
            if hit is not None:
                g, point = hit
                ray_face.append(f.index)
                ray_p.append(point)
                ray_n.append(tuple(N[g]))  # type: ignore[arg-type]
                ray_tri.append(g)
    P = np.asarray(ray_p, dtype=np.float64)
    PN = np.asarray(ray_n, dtype=np.float64)
    rays = list(zip(ray_face, ray_tri))

    best_min: Dict[int, float] = {}
    best_max: Dict[int, float] = {}
    count: Dict[int, int] = {}
    missed = 0
    for start in range(0, len(rays), _CHUNK):
        chunk = rays[start:start + _CHUNK]
        idx = np.asarray([g for _, g in chunk])
        rows = slice(start, start + len(chunk))
        d = -PN[rows]                                            # (R,3) into the material
        o = P[rows] + d * _START_INSIDE_MM
        # Moller-Trumbore, every ray against every triangle.
        p = np.cross(d[:, None, :], E2[None, :, :])              # (R,N,3)
        det = np.einsum("nj,rnj->rn", E1, p)
        ok = np.abs(det) > 1e-12
        inv = np.where(ok, 1.0 / np.where(ok, det, 1.0), 0.0)
        s = o[:, None, :] - V0[None, :, :]
        u = np.einsum("rnj,rnj->rn", s, p) * inv
        q = np.cross(s, E1[None, :, :])
        v = np.einsum("rj,rnj->rn", d, q) * inv
        t = np.einsum("nj,rnj->rn", E2, q) * inv
        # a surface the ray leaves the material through faces along the ray; the triangle it started on is not a hit
        leaves = np.einsum("rj,nj->rn", d, N) > 0
        hit = ok & (u >= 0) & (v >= 0) & (u + v <= 1) & (t > _MIN_HIT_MM) & leaves
        hit[np.arange(len(chunk)), idx] = False
        t = np.where(hit, t, np.inf)
        nearest = t.min(axis=1) + _START_INSIDE_MM
        centres = P[rows]
        for k, ((face_id, _), th) in enumerate(zip(chunk, nearest)):
            if not np.isfinite(th):
                missed += 1
                continue
            th = 2.0 * _shrink_ball(centres[k], PN[start + k], float(th) / 2.0, V0, E1, E2, tri_min, tri_max)
            best_min[face_id] = min(best_min.get(face_id, float("inf")), float(th))
            best_max[face_id] = max(best_max.get(face_id, 0.0), float(th))
            count[face_id] = count.get(face_id, 0) + 1
    # The thickness of a face is its largest ball: where the face sits on the thickness of the wall at all, even if some sample points of it (near an edge) read smaller.
    faces = [{"face_id": fid, "thickness_mm": round(best_max[fid], 3), "min_mm": round(best_min[fid], 3), "samples": count[fid]} for fid in sorted(best_min)]
    return {"method": "inward ray to the first exit", "resolution_mm": round(resolution_mm, 3), "rays": len(rays), "missed": missed, "faces": faces}
