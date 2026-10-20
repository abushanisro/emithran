"""Board outline from the outline layer: overall size, enclosed regions and their areas.

The outline is drawn as lines and arcs with a round aperture (the plotted line width). The board edge is the
CENTRE of that line, so every figure is taken on the centre line, not on the plotted extent.

Outline layers are not always one closed path: a panel is often drawn as several rectangles that share edges
(rails and boards). The drawn segments are therefore treated as a planar graph and every bounded region is
found, so shared edges and nested shapes are measured correctly. Arcs are followed as fine polylines.
"""
from __future__ import annotations

import math
from collections import defaultdict
from dataclasses import dataclass

from gerbonara import GerberFile

from parsers.gerber_layer import to_mm

SNAP_MM = 1e-3
ARC_STEP_RAD = math.radians(1.0)
MIN_REGION_MM2 = 1e-6


@dataclass(frozen=True)
class Region:
    length_mm: float
    width_mm: float
    area_mm2: float


@dataclass(frozen=True)
class Outline:
    length_mm: float
    width_mm: float
    min_x_mm: float
    min_y_mm: float
    area_mm2: float
    line_width_mm: float
    regions: tuple[Region, ...]
    dangling_ends: int


Point = tuple[float, float]


def _snap(x: float, y: float) -> Point:
    return (round(x / SNAP_MM) * SNAP_MM, round(y / SNAP_MM) * SNAP_MM)


def _polyline(obj) -> tuple[list[Point], float]:
    unit = obj.unit
    x1, y1, x2, y2 = (to_mm(v, unit) for v in (obj.x1, obj.y1, obj.x2, obj.y2))
    width = to_mm(getattr(obj.aperture, "diameter", 0.0) or 0.0, obj.aperture.unit)
    if type(obj).__name__ == "Line":
        return [(x1, y1), (x2, y2)], width
    # Gerbonara stores the arc centre as an offset from the start point.
    cx, cy = x1 + to_mm(obj.cx, unit), y1 + to_mm(obj.cy, unit)
    radius = math.hypot(x1 - cx, y1 - cy)
    a1, a2 = math.atan2(y1 - cy, x1 - cx), math.atan2(y2 - cy, x2 - cx)
    delta = a2 - a1
    if obj.clockwise:
        delta = delta - 2 * math.pi if delta > 0 else delta
    else:
        delta = delta + 2 * math.pi if delta < 0 else delta
    steps = max(2, int(math.ceil(abs(delta) / ARC_STEP_RAD)))
    points = [(cx + radius * math.cos(a1 + delta * i / steps), cy + radius * math.sin(a1 + delta * i / steps)) for i in range(steps + 1)]
    points[0], points[-1] = (x1, y1), (x2, y2)
    return points, width


def _graph(file: GerberFile) -> tuple[dict[Point, set[Point]], float]:
    adjacency: dict[Point, set[Point]] = defaultdict(set)
    widest = 0.0
    for obj in file.objects:
        kind = type(obj).__name__
        if kind not in ("Line", "Arc"):
            raise ValueError(f"outline layer holds a {kind}; only lines and arcs are read")
        points, width = _polyline(obj)
        widest = max(widest, width)
        snapped = [_snap(*p) for p in points]
        for a, b in zip(snapped, snapped[1:]):
            if a != b:  # an edge drawn twice (shared by two rectangles) is one edge
                adjacency[a].add(b)
                adjacency[b].add(a)
    return adjacency, widest


def _faces(adjacency: dict[Point, set[Point]]) -> list[list[Point]]:
    """Bounded faces of the planar graph, by half-edge traversal."""
    order = {v: sorted(ns, key=lambda n: math.atan2(n[1] - v[1], n[0] - v[0])) for v, ns in adjacency.items()}
    visited: set[tuple[Point, Point]] = set()
    faces: list[list[Point]] = []
    for u in adjacency:
        for v in adjacency[u]:
            if (u, v) in visited:
                continue
            face, a, b = [], u, v
            while (a, b) not in visited:
                visited.add((a, b))
                face.append(a)
                ring = order[b]
                # the next edge turns as far clockwise as possible from the way back to a
                a, b = b, ring[(ring.index(a) - 1) % len(ring)]
            faces.append(face)
    return faces


def _signed_area(face: list[Point]) -> float:
    return 0.5 * sum(x1 * y2 - x2 * y1 for (x1, y1), (x2, y2) in zip(face, face[1:] + face[:1]))


def measure_outline(file: GerberFile) -> Outline:
    adjacency, line_width = _graph(file)
    if not adjacency:
        raise ValueError("outline layer is empty")
    regions = []
    for face in _faces(adjacency):
        area = _signed_area(face)
        if area > MIN_REGION_MM2:  # counter-clockwise faces are bounded; the outer face is clockwise
            xs, ys = [p[0] for p in face], [p[1] for p in face]
            regions.append(Region(max(xs) - min(xs), max(ys) - min(ys), area))
    if not regions:
        raise ValueError("outline path does not enclose any region")
    xs, ys = [p[0] for p in adjacency], [p[1] for p in adjacency]
    return Outline(
        length_mm=max(xs) - min(xs),
        width_mm=max(ys) - min(ys),
        min_x_mm=min(xs),
        min_y_mm=min(ys),
        area_mm2=sum(r.area_mm2 for r in regions),
        line_width_mm=line_width,
        regions=tuple(sorted(regions, key=lambda r: -r.area_mm2)),
        dangling_ends=sum(1 for ns in adjacency.values() if len(ns) == 1),
    )
