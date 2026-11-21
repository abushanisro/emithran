"""
The voids of an additively built part: the pockets, ring pockets, enclosed cavities and non-round holes its loose powder or uncured resin is
left in, which cleaning has to clear (memory/Rapid prototyping cleaning* variables: a time per void scaled by its volume and depth, per hole
by its diameter and depth).

Method (voxels in the part's axis frame, the same column model as shared/core_geometry.py):
  1. solid       lines along z through a regular grid cast against the solid: voxel centres between an entry and an exit crossing are solid.
                 A line that grazes an edge reports an odd number of crossings; it is cast again a fraction of a cell aside, and skipped
                 (left as air, never guessed solid) when that fails too.
  2. trapped     an air voxel with solid on both sides of it along an axis (x, y or z) is enclosed along that axis. Air enclosed along at least
                 one axis, not inside a recognised round hole, is void air; connected void voxels (face neighbours) are one void.
  3. openings    a void is open towards a direction when one of its voxels has no solid beyond it that way.
                   none                  an enclosed cavity: a complex void, its depth the largest extent.
                   one                   a pocket: depth along the opening; a Ring when the solid stands up inside its outline (a pocket around
                                         a boss), else a simple void when its floor is flat (every column of it about as deep as the deepest),
                                         else a complex void.
                   both ends of one axis a passage through the part: a ComplexHole (a round one is a recognised hole, excluded in 2), its size
                                         the equivalent diameter 4 x area / perimeter of its section, its depth the passage length.
                   more                  an open recess (a slot, a step, a channel open on top): cleared with the part, not a void.
Volumes and depths are counted in voxels: a void smaller than a few voxels is not seen; the cell size is reported.
"""
from __future__ import annotations

import math
from collections import deque
from typing import Any, Dict, List, Optional, Sequence, Set, Tuple

from injection_molding.recognition.mesh import FaceMesh

# The voxels in the part's box (the die casting reference's voxelCount is 100000; a finer grid sees the small pockets a printed part has).
VOXEL_COUNT = 150_000
# A void of fewer voxels is the staircase left around a hole or a sloped wall, not a pocket.
MIN_VOXELS = 3
# A pocket is flat-floored (a simple void) when this share of its columns is within one voxel of its deepest.
FLAT_FLOOR_SHARE = 0.8
# Air within this many cells beyond a recognised hole's wall is the hole's (the voxel staircase around its round wall).
HOLE_MARGIN_CELLS = 1.0
_SAME_HIT_MM = 1e-6
_AXES = ("x", "y", "z")


def _crossings(intersector: Any, origin: Tuple[float, float, float], length: float) -> List[float]:
    from OCC.Core.gp import gp_Dir, gp_Lin, gp_Pnt  # type: ignore
    intersector.Perform(gp_Lin(gp_Pnt(*origin), gp_Dir(0.0, 0.0, 1.0)), 0.0, length)
    if not intersector.IsDone():
        return []
    out: List[float] = []
    for t in sorted(intersector.WParameter(i) for i in range(1, intersector.NbPnt() + 1)):
        if not out or t - out[-1] > _SAME_HIT_MM:
            out.append(t)
    return out


class _Grid:
    """The part's box in voxels, padded by one air cell on every side so outside air surrounds the part."""

    def __init__(self, lo: Sequence[float], hi: Sequence[float], voxel_count: int):
        span = [max(hi[i] - lo[i], 1e-6) for i in range(3)]
        self.cell = (span[0] * span[1] * span[2] / voxel_count) ** (1.0 / 3.0)
        self.n = [max(1, math.ceil(span[i] / self.cell)) + 2 for i in range(3)]
        self.lo = [lo[i] - self.cell for i in range(3)]
        self.size = self.n[0] * self.n[1] * self.n[2]

    def index(self, i: int, j: int, k: int) -> int:
        return (i * self.n[1] + j) * self.n[2] + k

    def ijk(self, v: int) -> Tuple[int, int, int]:
        k = v % self.n[2]
        j = (v // self.n[2]) % self.n[1]
        return v // (self.n[1] * self.n[2]), j, k

    def centre(self, i: int, j: int, k: int) -> Tuple[float, float, float]:
        return (self.lo[0] + (i + 0.5) * self.cell, self.lo[1] + (j + 0.5) * self.cell, self.lo[2] + (k + 0.5) * self.cell)

    def at(self, p: Sequence[float]) -> Optional[int]:
        c = [int(math.floor((p[a] - self.lo[a]) / self.cell)) for a in range(3)]
        if any(c[a] < 0 or c[a] >= self.n[a] for a in range(3)):
            return None
        return self.index(c[0], c[1], c[2])


def _solid(shape: Any, g: _Grid) -> Tuple[bytearray, int]:
    from OCC.Core.IntCurvesFace import IntCurvesFace_ShapeIntersector  # type: ignore
    intersector = IntCurvesFace_ShapeIntersector()
    intersector.Load(shape, 1e-6)
    solid = bytearray(g.size)
    length = g.n[2] * g.cell
    skipped = 0
    for i in range(g.n[0]):
        for j in range(g.n[1]):
            x, y, _ = g.centre(i, j, 0)
            ts: List[float] = []
            for nudge in (0.0, 0.137 * g.cell):
                ts = _crossings(intersector, (x + nudge, y + nudge * 0.61, g.lo[2]), length)
                if len(ts) % 2 == 0:
                    break
            if len(ts) % 2 == 1:
                skipped += 1
                continue
            for a, b in zip(ts[0::2], ts[1::2]):
                k0 = max(0, math.ceil(a / g.cell - 0.5))
                k1 = min(g.n[2] - 1, math.floor(b / g.cell - 0.5))
                for k in range(k0, k1 + 1):
                    solid[g.index(i, j, k)] = 1
    return solid, skipped


def _lines(g: _Grid, axis: int):
    """Every line of voxels along `axis`: the voxel indices in order."""
    others = [a for a in range(3) if a != axis]
    for p in range(g.n[others[0]]):
        for q in range(g.n[others[1]]):
            line = []
            for t in range(g.n[axis]):
                c = [0, 0, 0]
                c[axis], c[others[0]], c[others[1]] = t, p, q
                line.append(g.index(c[0], c[1], c[2]))
            yield line


def _in_holes(g: _Grid, holes: Sequence[Dict[str, Any]]) -> bytearray:
    """The voxels inside a recognised round hole's bore (each step's cylinder, a voxel's margin wider)."""
    mark = bytearray(g.size)
    margin = HOLE_MARGIN_CELLS * g.cell
    for h in holes:
        axis = h.get("axis")
        point = h.get("axis_point")
        if not axis or not point:
            continue
        for st in h.get("steps", []):
            if "t_min" not in st or "radius_mm" not in st:
                continue
            r = float(st["radius_mm"]) + margin
            t0, t1 = float(st["t_min"]) - margin, float(st["t_max"]) + margin
            # The step's bounding box, then the exact test per voxel centre.
            ends = [[point[a] + axis[a] * (t - sum(point[b] * axis[b] for b in range(3))) for a in range(3)] for t in (t0, t1)]
            lo = [min(ends[0][a], ends[1][a]) - r for a in range(3)]
            hi = [max(ends[0][a], ends[1][a]) + r for a in range(3)]
            rng = [range(max(0, int((lo[a] - g.lo[a]) / g.cell)), min(g.n[a], int((hi[a] - g.lo[a]) / g.cell) + 1)) for a in range(3)]
            for i in rng[0]:
                for j in rng[1]:
                    for k in rng[2]:
                        c = g.centre(i, j, k)
                        t = sum(c[a] * axis[a] for a in range(3))
                        if t < t0 or t > t1:
                            continue
                        rel = [c[a] - point[a] for a in range(3)]
                        along = sum(rel[a] * axis[a] for a in range(3))
                        radial = math.sqrt(max(0.0, sum(x * x for x in rel) - along * along))
                        if radial <= r:
                            mark[g.index(i, j, k)] = 1
    return mark


def _footprint(cells: Set[Tuple[int, int]]) -> Tuple[bool, int]:
    """Whether the outline has solid standing inside it (cells not in it that the outside cannot reach), and its boundary edge count."""
    ps = [c[0] for c in cells]
    qs = [c[1] for c in cells]
    p0, p1, q0, q1 = min(ps) - 1, max(ps) + 1, min(qs) - 1, max(qs) + 1
    seen: Set[Tuple[int, int]] = set()
    todo = deque([(p0, q0)])
    seen.add((p0, q0))
    while todo:
        p, q = todo.popleft()
        for dp, dq in ((1, 0), (-1, 0), (0, 1), (0, -1)):
            n = (p + dp, q + dq)
            if p0 <= n[0] <= p1 and q0 <= n[1] <= q1 and n not in seen and n not in cells:
                seen.add(n)
                todo.append(n)
    island = any((p, q) not in cells and (p, q) not in seen for p in range(p0, p1 + 1) for q in range(q0, q1 + 1))
    edges = sum(1 for (p, q) in cells for dp, dq in ((1, 0), (-1, 0), (0, 1), (0, -1)) if (p + dp, q + dq) not in cells)
    return island, edges


def find_voids(shape: Any, meshes: Sequence[FaceMesh], holes: Sequence[Dict[str, Any]], voxel_count: int = VOXEL_COUNT) -> Dict[str, Any]:
    pts = [v for f in meshes for t in f.triangles for v in t.vertices]
    if not pts:
        return {"voids": [], "cell_mm": None, "skipped_columns": 0, "open_recesses": 0, "void_at": lambda p: None}
    lo = [min(p[a] for p in pts) for a in range(3)]
    hi = [max(p[a] for p in pts) for a in range(3)]
    g = _Grid(lo, hi, voxel_count)
    solid, skipped = _solid(shape, g)
    hole = _in_holes(g, holes)

    # Air enclosed along an axis; and per voxel, per axis, whether solid lies beyond it on the low side and on the high side.
    trapped = bytearray(g.size)
    below = [bytearray(g.size) for _ in range(3)]
    above = [bytearray(g.size) for _ in range(3)]
    for axis in range(3):
        for line in _lines(g, axis):
            idx = [t for t, v in enumerate(line) if solid[v]]
            if not idx:
                continue
            first, last = idx[0], idx[-1]
            for t, v in enumerate(line):
                if t > first:
                    below[axis][v] = 1
                if t < last:
                    above[axis][v] = 1
                if first < t < last and not solid[v]:
                    trapped[v] = 1
    void = bytearray(g.size)
    for v in range(g.size):
        if trapped[v] and not solid[v] and not hole[v]:
            void[v] = 1

    # Connected voids.
    comps: List[List[int]] = []
    seen = bytearray(g.size)
    for v in range(g.size):
        if not void[v] or seen[v]:
            continue
        comp = [v]
        seen[v] = 1
        todo = deque([v])
        while todo:
            u = todo.popleft()
            i, j, k = g.ijk(u)
            for di, dj, dk in ((1, 0, 0), (-1, 0, 0), (0, 1, 0), (0, -1, 0), (0, 0, 1), (0, 0, -1)):
                a, b, c = i + di, j + dj, k + dk
                if 0 <= a < g.n[0] and 0 <= b < g.n[1] and 0 <= c < g.n[2]:
                    w = g.index(a, b, c)
                    if void[w] and not seen[w]:
                        seen[w] = 1
                        comp.append(w)
                        todo.append(w)
        if len(comp) >= MIN_VOXELS:
            comps.append(comp)

    # Which voxel each mesh face looks into: a point just off each triangle, along its normal (out of the material).
    face_cells: Dict[int, Set[int]] = {}
    for f in meshes:
        cells: Set[int] = set()
        for t in f.triangles:
            p = tuple(t.centroid[a] + t.normal[a] * 0.6 * g.cell for a in range(3))
            w = g.at(p)
            if w is not None:
                cells.add(w)
        face_cells[f.index] = cells

    cell3 = g.cell ** 3
    voids: List[Dict[str, Any]] = []
    open_recesses = 0
    for comp in comps:
        members = set(comp)
        opens = sorted({(axis, sign) for v in comp for axis in range(3) for sign, beyond in ((-1, below[axis]), (1, above[axis])) if not beyond[v]})
        ijk = [g.ijk(v) for v in comp]
        extent = [(max(c[a] for c in ijk) - min(c[a] for c in ijk) + 1) * g.cell for a in range(3)]
        centroid = [round(sum(g.centre(*c)[a] for c in ijk) / len(ijk), 3) for a in range(3)]
        volume = len(comp) * cell3
        through = len(opens) == 2 and opens[0][0] == opens[1][0]
        if len(opens) > 1 and not through:
            open_recesses += 1
            continue
        face_ids = sorted(fid for fid, cells in face_cells.items() if cells & members)
        base = {"volume_mm3": round(volume, 3), "centroid": centroid, "face_ids": face_ids, "_cells": comp}
        if not opens:
            voids.append({**base, "feature_type": "Void", "variant": "complex", "enclosed": True, "depth_mm": round(max(extent), 3), "open_axis": None})
            continue
        axis = opens[0][0]
        others = [a for a in range(3) if a != axis]
        columns: Dict[Tuple[int, int], int] = {}
        for c in ijk:
            key = (c[others[0]], c[others[1]])
            columns[key] = columns.get(key, 0) + 1
        island, edges = _footprint(set(columns))
        depth = max(columns.values()) * g.cell
        if through:
            area = len(columns) * g.cell ** 2
            perimeter = edges * g.cell
            voids.append({**base, "feature_type": "ComplexHole", "variant": "through", "depth_mm": round(extent[axis], 3), "open_axis": _AXES[axis],
                          "equivalent_diameter_mm": round(4 * area / perimeter, 3) if perimeter > 0 else None, "section_area_mm2": round(area, 3)})
            continue
        sign = "+" if opens[0][1] > 0 else "-"
        deepest = max(columns.values())
        flat = sum(1 for d in columns.values() if d >= deepest - 1) >= FLAT_FLOOR_SHARE * len(columns)
        ftype, variant = ("Ring", "ringed") if island else ("Void", "simple" if flat else "complex")
        voids.append({**base, "feature_type": ftype, "variant": variant, "enclosed": False, "depth_mm": round(depth, 3), "open_axis": f"{sign}{_AXES[axis]}"})

    voids.sort(key=lambda v: (-v["volume_mm3"], v["centroid"]))
    for n, v in enumerate(voids, 1):
        v["id"] = f"void-{n}"
    # Which void a point lies in (None: solid, outside air, a hole's bore or an open recess), for a caller that asks where an opening leads.
    owner: Dict[int, str] = {}
    for v in voids:
        for cell in v.pop("_cells"):
            owner[cell] = v["id"]

    def void_at(p: Sequence[float]) -> Optional[str]:
        w = g.at(p)
        return owner.get(w) if w is not None else None

    return {"voids": voids, "cell_mm": round(g.cell, 4), "skipped_columns": skipped, "open_recesses": open_recesses, "void_at": void_at}
