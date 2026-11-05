"""
The parting line: where the two mold halves meet, found as the ridge on the part where the surface turns from facing the pull direction to facing away.

READING. The staged variables name "flat" and "non-flat" parting lines (they scale design hours) without defining them. Here a parting line is flat when all of
its points lie in one plane square to the pull, to within FLAT_TOLERANCE_FRACTION of the part's extent along the pull; non-flat when they step or curve. A part
whose walls are exactly along the pull (no draft) has no ridge between a face facing up and one facing down: it is reported as `indeterminate` with the reason,
never given a line it does not show. Length is the tessellated edge length (it follows the mesh zig-zag, so it is an upper estimate). Only ridges on the OUTLINE of the part's projection along the pull count (the silhouette): a ridge inside the outline, such as a
dome or dimple in a free-form face, is covered by material on one side and is not where the halves meet.
"""
from __future__ import annotations

import math
from collections import defaultdict
from typing import Any, Dict, Sequence, Tuple

from .mesh import FaceMesh
from .vec import Vec, cross, dot, unit

READING = "parting_line_reading_v1"
FLAT_TOLERANCE_FRACTION = 0.01
GRID = 200


def _basis(d: Vec) -> Tuple[Vec, Vec]:
    a = (1.0, 0.0, 0.0) if abs(d[0]) < 0.9 else (0.0, 1.0, 0.0)
    e1 = unit(cross(d, a))
    return e1, cross(d, e1)


def _outline_cells(meshes: Sequence[FaceMesh], p: Vec) -> Tuple[set, Any]:
    """Cells on the boundary of the part's projection along the pull, and the function that maps a point to its cell."""
    e1, e2 = _basis(p)
    pts = [(dot(v, e1), dot(v, e2)) for f in meshes for t in f.triangles for v in t.vertices]
    u0, u1, v0, v1 = min(x for x, _ in pts), max(x for x, _ in pts), min(y for _, y in pts), max(y for _, y in pts)
    cell = max(u1 - u0, v1 - v0, 1e-6) / GRID

    def cell_of(point: Vec) -> Tuple[int, int]:
        return (math.floor((dot(point, e1) - u0) / cell), math.floor((dot(point, e2) - v0) / cell))

    occupied = set()
    for f in meshes:
        for t in f.triangles:
            a, b, c = t.vertices
            n = max(1, int(math.ceil(max(math.dist(a, b), math.dist(b, c), math.dist(c, a)) / cell)))
            for i in range(n + 1):
                for j in range(n + 1 - i):
                    wb, wc = i / n, j / n
                    wa = 1.0 - wb - wc
                    occupied.add(cell_of((wa * a[0] + wb * b[0] + wc * c[0], wa * a[1] + wb * b[1] + wc * c[1], wa * a[2] + wb * b[2] + wc * c[2])))
    outline = {(i, j) for (i, j) in occupied if any((i + di, j + dj) not in occupied for di, dj in ((1, 0), (-1, 0), (0, 1), (0, -1)))}
    return outline, cell_of


def parting_line(meshes: Sequence[FaceMesh], pull: Vec, undrafted_deg: float) -> Dict[str, Any]:
    p = unit(pull)
    eps = math.sin(math.radians(undrafted_deg))
    edges: Dict[Tuple, list] = defaultdict(list)
    heights = []
    for f in meshes:
        for t in f.triangles:
            side = 1 if dot(t.normal, p) > eps else -1 if dot(t.normal, p) < -eps else 0
            ks = [tuple(round(c * 1000) for c in v) for v in t.vertices]
            for a, b, va, vb in ((0, 1, t.vertices[0], t.vertices[1]), (1, 2, t.vertices[1], t.vertices[2]), (2, 0, t.vertices[2], t.vertices[0])):
                edges[tuple(sorted((ks[a], ks[b])))].append((side, va, vb))
            heights.extend(dot(v, p) for v in t.vertices)
    if not heights:
        return {"status": "indeterminate", "reason": "the part has no mesh", "reading": READING}
    extent = max(heights) - min(heights)
    outline, cell_of = _outline_cells(meshes, p)

    def on_outline(va: Vec, vb: Vec) -> bool:
        i, j = cell_of(((va[0] + vb[0]) / 2, (va[1] + vb[1]) / 2, (va[2] + vb[2]) / 2))
        return any((i + di, j + dj) in outline for di in (-1, 0, 1) for dj in (-1, 0, 1))

    length = 0.0
    ridge_heights = []
    for tris in edges.values():
        up = [x for x in tris if x[0] == 1]
        down = [x for x in tris if x[0] == -1]
        if up and down:
            _, va, vb = up[0]
            if not on_outline(va, vb):
                continue
            length += math.dist(va, vb)
            ridge_heights.extend((dot(va, p), dot(vb, p)))
    if not ridge_heights:
        return {
            "status": "indeterminate", "reading": READING,
            "reason": "no edge turns from facing the pull direction to facing away: the walls are along the pull (no draft), so where the halves meet is not shown by the geometry",
        }
    spread = max(ridge_heights) - min(ridge_heights)
    flat = spread <= FLAT_TOLERANCE_FRACTION * max(extent, 1e-9)
    return {
        "status": "found", "reading": READING, "variant": "flat" if flat else "non_flat", "length_mm": round(length, 2),
        "height_spread_mm": round(spread, 3), "part_extent_along_pull_mm": round(extent, 3),
    }
