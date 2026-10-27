"""Plane geometry for copper analysis: every drawn copper object reduced to a capsule or a polygon, in millimetres.

A capsule is a segment swept by a disk (a round-aperture stroke; a circle when both ends meet). A polygon is a closed list
of vertices (rectangles, rotated pads, regions, arc polygons with their arcs flattened). Pure Python, no array library: the
engine stays dependency-light, and a spatial grid keeps neighbour queries local.
"""
from __future__ import annotations

import math
from collections import defaultdict
from dataclasses import dataclass, field
from typing import Iterable, Iterator

EPS = 1e-9


@dataclass
class Shape:
    kind: str  # "cap" | "poly"
    layer: str = ""
    # capsule
    x1: float = 0.0
    y1: float = 0.0
    x2: float = 0.0
    y2: float = 0.0
    r: float = 0.0
    # polygon
    pts: list[tuple[float, float]] = field(default_factory=list)
    flash: bool = False  # a flashed pad (as opposed to a drawn stroke or region)
    _bbox: tuple[float, float, float, float] | None = None

    def bbox(self) -> tuple[float, float, float, float]:
        if self._bbox is None:
            if self.kind == "cap":
                self._bbox = (min(self.x1, self.x2) - self.r, min(self.y1, self.y2) - self.r,
                              max(self.x1, self.x2) + self.r, max(self.y1, self.y2) + self.r)
            else:
                xs = [p[0] for p in self.pts]
                ys = [p[1] for p in self.pts]
                self._bbox = (min(xs), min(ys), max(xs), max(ys))
        return self._bbox

    def center(self) -> tuple[float, float]:
        if self.kind == "cap":
            return ((self.x1 + self.x2) / 2, (self.y1 + self.y2) / 2)
        x0, y0, x1, y1 = self.bbox()
        return ((x0 + x1) / 2, (y0 + y1) / 2)

    def min_width(self) -> float:
        if self.kind == "cap":
            return 2 * self.r
        x0, y0, x1, y1 = self.bbox()
        return min(x1 - x0, y1 - y0)


def capsule(x1: float, y1: float, x2: float, y2: float, r: float, layer: str = "", flash: bool = False) -> Shape:
    return Shape("cap", layer, x1, y1, x2, y2, r, flash=flash)


def polygon(points: Iterable[tuple[float, float]], layer: str = "", flash: bool = False) -> Shape:
    pts = list(points)
    if len(pts) > 1 and pts[0] == pts[-1]:
        pts.pop()
    return Shape("poly", layer, pts=pts, flash=flash)


def rectangle(cx: float, cy: float, w: float, h: float, rotation_rad: float = 0.0, layer: str = "", flash: bool = False) -> Shape:
    c, s = math.cos(rotation_rad), math.sin(rotation_rad)
    corners = [(-w / 2, -h / 2), (w / 2, -h / 2), (w / 2, h / 2), (-w / 2, h / 2)]
    return polygon([(cx + x * c - y * s, cy + x * s + y * c) for x, y in corners], layer, flash)


# ---------------------------------------------------------------------------------------------------- distances
def _pt_seg(px: float, py: float, ax: float, ay: float, bx: float, by: float) -> float:
    dx, dy = bx - ax, by - ay
    length2 = dx * dx + dy * dy
    t = 0.0 if length2 == 0 else max(0.0, min(1.0, ((px - ax) * dx + (py - ay) * dy) / length2))
    return math.hypot(px - ax - t * dx, py - ay - t * dy)


def _orient(p, q, r) -> float:
    return (q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0])


def seg_seg(a, b, c, d) -> float:
    o1, o2, o3, o4 = _orient(a, b, c), _orient(a, b, d), _orient(c, d, a), _orient(c, d, b)
    if o1 * o2 < 0 and o3 * o4 < 0:  # proper crossing; touching and collinear cases fall to the distances below
        return 0.0
    return min(_pt_seg(*a, *c, *d), _pt_seg(*b, *c, *d), _pt_seg(*c, *a, *b), _pt_seg(*d, *a, *b))


def _edges(pts: list[tuple[float, float]]) -> Iterator[tuple[tuple[float, float], tuple[float, float]]]:
    n = len(pts)
    for i in range(n):
        yield pts[i], pts[(i + 1) % n]


def point_in_polygon(x: float, y: float, pts: list[tuple[float, float]]) -> bool:
    inside = False
    n = len(pts)
    j = n - 1
    for i in range(n):
        xi, yi = pts[i]
        xj, yj = pts[j]
        if (yi > y) != (yj > y) and x < (xj - xi) * (y - yi) / (yj - yi) + xi:
            inside = not inside
        j = i
    return inside


def contains_point(s: Shape, x: float, y: float) -> bool:
    if s.kind == "cap":
        return _pt_seg(x, y, s.x1, s.y1, s.x2, s.y2) <= s.r + EPS
    x0, y0, x1, y1 = s.bbox()
    if x < x0 - EPS or x > x1 + EPS or y < y0 - EPS or y > y1 + EPS:
        return False
    if point_in_polygon(x, y, s.pts):
        return True
    return any(_pt_seg(x, y, *a, *b) <= EPS for a, b in _edges(s.pts))


def gap(s: Shape, t: Shape) -> float:
    """Edge-to-edge distance between two shapes; zero or less means they touch or overlap."""
    if s.kind == "cap" and t.kind == "cap":
        return seg_seg((s.x1, s.y1), (s.x2, s.y2), (t.x1, t.y1), (t.x2, t.y2)) - s.r - t.r
    if s.kind == "poly" and t.kind == "poly":
        if contains_point(s, *t.pts[0]) or contains_point(t, *s.pts[0]):
            return 0.0
        return min(seg_seg(a, b, c, d) for a, b in _edges(s.pts) for c, d in _edges(t.pts))
    cap, poly = (s, t) if s.kind == "cap" else (t, s)
    if contains_point(poly, cap.x1, cap.y1) or contains_point(poly, cap.x2, cap.y2):
        return -cap.r
    d = min(seg_seg((cap.x1, cap.y1), (cap.x2, cap.y2), a, b) for a, b in _edges(poly.pts))
    return d - cap.r


# ---------------------------------------------------------------------------------------------------- indexing
class Grid:
    def __init__(self, shapes: list[Shape], cell: float = 2.0, pad: float = 0.0):
        self.cell = cell
        self.cells: dict[tuple[int, int], list[int]] = defaultdict(list)
        for i, s in enumerate(shapes):
            x0, y0, x1, y1 = s.bbox()
            for gx in range(math.floor((x0 - pad) / cell), math.floor((x1 + pad) / cell) + 1):
                for gy in range(math.floor((y0 - pad) / cell), math.floor((y1 + pad) / cell) + 1):
                    self.cells[(gx, gy)].append(i)

    def near(self, x0: float, y0: float, x1: float, y1: float) -> Iterator[int]:
        c = self.cell
        seen: set[int] = set()
        for gx in range(math.floor(x0 / c), math.floor(x1 / c) + 1):
            for gy in range(math.floor(y0 / c), math.floor(y1 / c) + 1):
                for i in self.cells.get((gx, gy), ()):
                    if i not in seen:
                        seen.add(i)
                        yield i


class UnionFind:
    def __init__(self, n: int):
        self.parent = list(range(n))

    def find(self, a: int) -> int:
        while self.parent[a] != a:
            self.parent[a] = self.parent[self.parent[a]]
            a = self.parent[a]
        return a

    def union(self, a: int, b: int) -> None:
        ra, rb = self.find(a), self.find(b)
        if ra != rb:
            self.parent[rb] = ra


def connect(shapes: list[Shape], uf: UnionFind | None = None) -> UnionFind:
    """Joins shapes on the same layer that touch. Layers are joined separately, through plated holes."""
    uf = uf or UnionFind(len(shapes))
    grid = Grid(shapes)
    for i, s in enumerate(shapes):
        for j in grid.near(*s.bbox()):
            if j > i and shapes[j].layer == s.layer and uf.find(i) != uf.find(j) and gap(s, shapes[j]) <= EPS:
                uf.union(i, j)
    return uf


def min_clearance(shapes: list[Shape], net_of: list[int], limit: float) -> tuple[float, int, int] | None:
    """Smallest edge gap between shapes of different nets on the same layer, searched within `limit` mm."""
    grid = Grid(shapes, pad=limit)
    best: tuple[float, int, int] | None = None
    for i, s in enumerate(shapes):
        x0, y0, x1, y1 = s.bbox()
        for j in grid.near(x0 - limit, y0 - limit, x1 + limit, y1 + limit):
            if j > i and shapes[j].layer == s.layer and net_of[i] != net_of[j]:
                d = gap(s, shapes[j])
                if d <= limit and (best is None or d < best[0]):
                    best = (d, i, j)
    return best


# ---------------------------------------------------------------------------------------------------- area
def _row_interval(s: Shape, y: float) -> list[tuple[float, float]]:
    if s.kind == "cap":
        out: list[tuple[float, float]] = []
        for cx, cy in ((s.x1, s.y1), (s.x2, s.y2)):
            dy = y - cy
            if abs(dy) <= s.r:
                h = math.sqrt(s.r * s.r - dy * dy)
                out.append((cx - h, cx + h))
        dx, dyy = s.x2 - s.x1, s.y2 - s.y1
        length = math.hypot(dx, dyy)
        if length > EPS:
            nx, ny = -dyy / length * s.r, dx / length * s.r
            body = [(s.x1 + nx, s.y1 + ny), (s.x2 + nx, s.y2 + ny), (s.x2 - nx, s.y2 - ny), (s.x1 - nx, s.y1 - ny)]
            out.extend(_poly_row(body, y))
        if not out:
            return []
        return [(min(a for a, _ in out), max(b for _, b in out))]  # a capsule is convex: one interval
    return _poly_row(s.pts, y)


def _poly_row(pts: list[tuple[float, float]], y: float) -> list[tuple[float, float]]:
    xs: list[float] = []
    for (xa, ya), (xb, yb) in _edges(pts):
        if (ya > y) != (yb > y):
            xs.append(xa + (y - ya) * (xb - xa) / (yb - ya))
    xs.sort()
    return [(xs[k], xs[k + 1]) for k in range(0, len(xs) - 1, 2)]


def union_area(shapes: list[Shape], step: float = 0.05) -> float:
    """Area covered by the union of the shapes (overlaps counted once), by horizontal scanlines `step` mm apart."""
    if not shapes:
        return 0.0
    rows: dict[int, list[int]] = defaultdict(list)
    for i, s in enumerate(shapes):
        _, y0, _, y1 = s.bbox()
        for k in range(math.floor(y0 / step), math.floor(y1 / step) + 1):
            rows[k].append(i)
    total = 0.0
    for k, members in rows.items():
        y = (k + 0.5) * step
        spans: list[tuple[float, float]] = []
        for i in members:
            spans.extend(_row_interval(shapes[i], y))
        if not spans:
            continue
        spans.sort()
        cur_a, cur_b = spans[0]
        covered = 0.0
        for a, b in spans[1:]:
            if a > cur_b:
                covered += cur_b - cur_a
                cur_a, cur_b = a, b
            elif b > cur_b:
                cur_b = b
        covered += cur_b - cur_a
        total += covered * step
    return total
