"""
Cores of a cast part: the regions of air no die half can reach by a straight
pull, measured from the solid itself.

Method: cast lines parallel to the pull axis through a regular grid on the
parting plane. Along one line the solid is a run of [entry, exit] intervals;
the air BETWEEN two solid intervals has solid on both sides along the pull,
so neither die half (they move only along the pull axis) can form it -- it
needs a core (a sand core in gravity die casting, a slide or core pin in a
pressure die). Air before the first or after the last interval is open to a
die half and is not a core. Trapped segments in neighbouring grid columns
whose spans along the pull overlap belong to the same core (union-find), so
each core is one connected region.

Per core: volume (sum of segment length x cell area), box (extent along the
two grid axes and along the pull) and outer area. The area is the boundary of
the column model: the two caps of every segment plus the side walls not
shared with a neighbouring segment -- exact for faces parallel or normal to
the pull, a staircase over-estimate for oblique ones (reported as such).

Grid resolution: memory/Die Casting/Die casting_variables.csv voxelCount
(100000, "an approximation of the number of voxels in the part bounding box")
-- the cell edge is chosen so the part box holds that many cells. A line that
grazes an edge or a tangent face can report an odd number of crossings; such
columns are skipped and counted, never guessed.
"""
from __future__ import annotations

import math
from typing import Any, Dict, List, Sequence, Tuple

from shared.casting_geometry import _ensure_mesh, _face_triangles, _faces, _plane_basis, _dot

# memory/Die Casting/Die casting_variables.csv: voxelCount = 100000.
VOXEL_COUNT = 100_000
# Crossings closer than this along a line are one crossing (a line through a
# shared edge reports it once per face).
_SAME_HIT_MM = 1e-6


def _crossings(intersector: Any, origin: Tuple[float, float, float], direction: Tuple[float, float, float], length: float) -> List[float]:
    from OCC.Core.gp import gp_Pnt, gp_Dir, gp_Lin  # type: ignore
    intersector.Perform(gp_Lin(gp_Pnt(*origin), gp_Dir(*direction)), 0.0, length)
    if not intersector.IsDone():
        return []
    ts = sorted(intersector.WParameter(i) for i in range(1, intersector.NbPnt() + 1))
    out: List[float] = []
    for t in ts:
        if not out or t - out[-1] > _SAME_HIT_MM:
            out.append(t)
    return out


def trapped_cores(shape: Any, pull_axis: Sequence[float], voxel_count: int = VOXEL_COUNT, linear_deflection: float = 0.1) -> Dict[str, Any]:
    from OCC.Core.IntCurvesFace import IntCurvesFace_ShapeIntersector  # type: ignore

    n_len = math.sqrt(sum(float(x) * float(x) for x in pull_axis))
    n = tuple(float(x) / n_len for x in pull_axis)
    u, v = _plane_basis(n)

    # Part extent in the (u, v, n) frame, from the mesh.
    _ensure_mesh(shape, linear_deflection)
    lo = [math.inf] * 3
    hi = [-math.inf] * 3
    for face in _faces(shape):
        for t in _face_triangles(face):
            for p in t:
                for i, axis in enumerate((u, v, n)):
                    d = _dot(p, axis)
                    lo[i] = min(lo[i], d)
                    hi[i] = max(hi[i], d)
    if not all(math.isfinite(x) for x in lo + hi):
        return {"core_count": 0, "cores": [], "cell_mm": None, "columns": 0, "skipped_columns": 0}
    span = [hi[i] - lo[i] for i in range(3)]
    cell = (span[0] * span[1] * max(span[2], 1e-9) / voxel_count) ** (1.0 / 3.0)
    nu = max(1, math.ceil(span[0] / cell))
    nv = max(1, math.ceil(span[1] / cell))
    du, dv = span[0] / nu, span[1] / nv
    cell_area = du * dv

    intersector = IntCurvesFace_ShapeIntersector()
    intersector.Load(shape, 1e-6)
    margin = 1.0
    length = span[2] + 2 * margin

    # Trapped segments per column: (i, j, start, end) along n, absolute.
    segments: List[Tuple[int, int, float, float]] = []
    by_column: Dict[Tuple[int, int], List[int]] = {}
    skipped = 0
    for i in range(nu):
        cu = lo[0] + (i + 0.5) * du
        for j in range(nv):
            cv = lo[1] + (j + 0.5) * dv
            start_n = lo[2] - margin
            origin = tuple(cu * u[k] + cv * v[k] + start_n * n[k] for k in range(3))
            ts = _crossings(intersector, origin, n, length)
            if len(ts) % 2 == 1:
                skipped += 1
                continue
            # Solid intervals are [ts[0], ts[1]], [ts[2], ts[3]], ...; the air
            # between consecutive intervals is trapped.
            for k in range(1, len(ts) - 1, 2):
                a, b = start_n + ts[k], start_n + ts[k + 1]
                if b - a > _SAME_HIT_MM:
                    by_column.setdefault((i, j), []).append(len(segments))
                    segments.append((i, j, a, b))

    # Union-find over segments overlapping along n in 4-neighbouring columns.
    parent = list(range(len(segments)))

    def find(x: int) -> int:
        while parent[x] != x:
            parent[x] = parent[parent[x]]
            x = parent[x]
        return x

    def overlap(s: Tuple[int, int, float, float], t: Tuple[int, int, float, float]) -> float:
        return max(0.0, min(s[3], t[3]) - max(s[2], t[2]))

    for (i, j), ids in by_column.items():
        for di, dj in ((1, 0), (0, 1)):
            for nb in by_column.get((i + di, j + dj), []):
                for s in ids:
                    if overlap(segments[s], segments[nb]) > 0:
                        parent[find(s)] = find(nb)

    groups: Dict[int, List[int]] = {}
    for s in range(len(segments)):
        groups.setdefault(find(s), []).append(s)

    cores: List[Dict[str, Any]] = []
    for ids in groups.values():
        segs = [segments[s] for s in ids]
        volume = sum((b - a) * cell_area for _, _, a, b in segs)
        caps = 2 * cell_area * len(segs)
        sides = 0.0
        for idx in ids:
            s = segments[idx]
            for di, dj, wall in ((1, 0, dv), (-1, 0, dv), (0, 1, du), (0, -1, du)):
                shared = sum(overlap(s, segments[nb]) for nb in by_column.get((s[0] + di, s[1] + dj), []) if find(nb) == find(idx))
                sides += max(0.0, (s[3] - s[2]) - shared) * wall
        ii = [s[0] for s in segs]
        jj = [s[1] for s in segs]
        n_lo = min(s[2] for s in segs)
        n_hi = max(s[3] for s in segs)
        box = [(max(ii) - min(ii) + 1) * du, (max(jj) - min(jj) + 1) * dv, n_hi - n_lo]
        cu = lo[0] + (min(ii) + max(ii) + 1) / 2 * du
        cv = lo[1] + (min(jj) + max(jj) + 1) / 2 * dv
        cn = (n_lo + n_hi) / 2
        centroid = [cu * u[k] + cv * v[k] + cn * n[k] for k in range(3)]
        cores.append({
            "volume_mm3": round(volume, 3),
            "box_mm": [round(x, 3) for x in sorted(box, reverse=True)],
            "area_mm2": round(caps + sides, 3),
            "area_method": "column_boundary",
            "centroid": [round(x, 3) for x in centroid],
        })
    cores.sort(key=lambda c: c["volume_mm3"], reverse=True)
    return {
        "core_count": len(cores),
        "cores": cores,
        "cell_mm": round(cell, 4),
        "columns": nu * nv,
        "skipped_columns": skipped,
    }
