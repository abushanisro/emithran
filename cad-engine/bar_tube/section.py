"""
A bar's or tube's cross-section, classified from its outline.

The section is cut across the stock (normal to its centreline) and handed here as 2D outlines: the outer boundary and any inner boundaries
(the hollows), each a closed list of (x, y) points in mm. What it is decides which stock is bought and what can cut and bend it:

  ROUND_TUBE / ROUND_BAR          a circular outline (to within ROUND_TOLERANCE of its mean radius), hollow or solid
  SQUARE_TUBE / SQUARE_BAR        an outline that fills its smallest bounding rectangle (corner radii allowed), equal sides
  RECTANGULAR_TUBE / _BAR         the same with unequal sides (a flat bar is a rectangular bar)
  HEX_BAR                         six equal sides, filling three quarters of its bounding rectangle
  ANGLE_BAR, CHANNEL_BAR,         open structural sections, told apart by their reflex (inside) corners: an angle has one; a channel two
  T_BEAM, I_BEAM                  side by side (its inside corners are next to each other); a tee two apart (one each side of the stem);
                                  an I-beam four
  GENERIC_EXTRUSION               anything else: a profile that is extruded to shape

The names are the stock forms of the reference data (memory/Bar and tube fab lookup/saw_routing_evaluation.csv).
"""
from __future__ import annotations

import math
from typing import Any, Dict, List, Optional, Sequence, Tuple

Pt = Tuple[float, float]

ROUND_TOLERANCE = 0.01        # a circle: every outline point within 1 % of the mean radius
RECT_FILL = 0.95              # a rectangle with corner radii still fills 95 % of its bounding rectangle
SQUARE_TOLERANCE = 0.02       # sides within 2 % are a square
HEX_FILL = (0.72, 0.78)       # a regular hexagon fills 3/4 of its bounding rectangle
SIMPLIFY_FRACTION = 0.03      # outline simplification, a share of the section's size (fillets and corner radii are smaller)


def area(poly: Sequence[Pt]) -> float:
    """Signed area (positive when counter-clockwise)."""
    return 0.5 * sum(poly[i][0] * poly[(i + 1) % len(poly)][1] - poly[(i + 1) % len(poly)][0] * poly[i][1] for i in range(len(poly)))


def perimeter(poly: Sequence[Pt]) -> float:
    return sum(math.dist(poly[i], poly[(i + 1) % len(poly)]) for i in range(len(poly)))


def centroid(poly: Sequence[Pt]) -> Pt:
    a = area(poly)
    if abs(a) < 1e-12:
        return (sum(p[0] for p in poly) / len(poly), sum(p[1] for p in poly) / len(poly))
    cx = cy = 0.0
    for i in range(len(poly)):
        (x0, y0), (x1, y1) = poly[i], poly[(i + 1) % len(poly)]
        c = x0 * y1 - x1 * y0
        cx += (x0 + x1) * c
        cy += (y0 + y1) * c
    return (cx / (6.0 * a), cy / (6.0 * a))


def hull(points: Sequence[Pt]) -> List[Pt]:
    """Convex hull, counter-clockwise (Andrew's monotone chain)."""
    pts = sorted(set((round(p[0], 6), round(p[1], 6)) for p in points))
    if len(pts) < 3:
        return list(pts)

    def turn(o: Pt, a: Pt, b: Pt) -> float:
        return (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0])
    lower: List[Pt] = []
    for p in pts:
        while len(lower) >= 2 and turn(lower[-2], lower[-1], p) <= 0:
            lower.pop()
        lower.append(p)
    upper: List[Pt] = []
    for p in reversed(pts):
        while len(upper) >= 2 and turn(upper[-2], upper[-1], p) <= 0:
            upper.pop()
        upper.append(p)
    return lower[:-1] + upper[:-1]


def min_area_rect(points: Sequence[Pt]) -> Tuple[float, float, float]:
    """The smallest rectangle around the points: (long side, short side, angle of the long side in degrees)."""
    h = hull(points)
    if len(h) < 3:
        return (0.0, 0.0, 0.0)
    best: Optional[Tuple[float, float, float, float]] = None
    for i in range(len(h)):
        (x0, y0), (x1, y1) = h[i], h[(i + 1) % len(h)]
        ang = math.atan2(y1 - y0, x1 - x0)
        c, s = math.cos(ang), math.sin(ang)
        us = [p[0] * c + p[1] * s for p in h]
        vs = [-p[0] * s + p[1] * c for p in h]
        w, ht = max(us) - min(us), max(vs) - min(vs)
        if best is None or w * ht < best[0]:
            best = (w * ht, w, ht, ang)
    _, w, ht, ang = best  # type: ignore[misc]
    return (max(w, ht), min(w, ht), math.degrees(ang if w >= ht else ang + math.pi / 2) % 180.0)


def enclosing_circle_diameter(points: Sequence[Pt]) -> float:
    """The smallest circle around the points (the extrusion press's circumscribing circle), over the hull's points."""
    h = hull(points)
    if not h:
        return 0.0
    best = 0.0
    # The smallest enclosing circle passes through two or three hull points; for the few points of a section, try them.
    centre_r: Optional[Tuple[Pt, float]] = None
    n = len(h)

    def covers(c: Pt, r: float) -> bool:
        return all(math.dist(c, p) <= r + 1e-6 for p in h)
    for i in range(n):
        for j in range(i + 1, n):
            c = ((h[i][0] + h[j][0]) / 2.0, (h[i][1] + h[j][1]) / 2.0)
            r = math.dist(h[i], h[j]) / 2.0
            if (centre_r is None or r < centre_r[1]) and covers(c, r):
                centre_r = (c, r)
    if n <= 60:
        for i in range(n):
            for j in range(i + 1, n):
                for k in range(j + 1, n):
                    c3 = _circumcentre(h[i], h[j], h[k])
                    if c3 is None:
                        continue
                    r = math.dist(c3, h[i])
                    if (centre_r is None or r < centre_r[1]) and covers(c3, r):
                        centre_r = (c3, r)
    if centre_r is None:
        best = max(math.dist(a, b) for a in h for b in h)
        return best
    return 2.0 * centre_r[1]


def _circumcentre(a: Pt, b: Pt, c: Pt) -> Optional[Pt]:
    d = 2.0 * (a[0] * (b[1] - c[1]) + b[0] * (c[1] - a[1]) + c[0] * (a[1] - b[1]))
    if abs(d) < 1e-12:
        return None
    ux = ((a[0] ** 2 + a[1] ** 2) * (b[1] - c[1]) + (b[0] ** 2 + b[1] ** 2) * (c[1] - a[1]) + (c[0] ** 2 + c[1] ** 2) * (a[1] - b[1])) / d
    uy = ((a[0] ** 2 + a[1] ** 2) * (c[0] - b[0]) + (b[0] ** 2 + b[1] ** 2) * (a[0] - c[0]) + (c[0] ** 2 + c[1] ** 2) * (b[0] - a[0])) / d
    return (ux, uy)


def simplify(poly: Sequence[Pt], eps: float) -> List[Pt]:
    """Douglas-Peucker on a closed outline: the corners that stand more than eps off the straight line between their neighbours."""
    if len(poly) < 4:
        return list(poly)
    # Split the ring at its two farthest-apart points, simplify each half as an open line.
    i0 = 0
    i1 = max(range(len(poly)), key=lambda i: math.dist(poly[i0], poly[i]))
    i0 = max(range(len(poly)), key=lambda i: math.dist(poly[i1], poly[i]))
    if i0 > i1:
        i0, i1 = i1, i0
    a = list(poly[i0:i1 + 1])
    b = list(poly[i1:]) + list(poly[:i0 + 1])
    return _dp(a, eps)[:-1] + _dp(b, eps)[:-1]


def _dp(line: List[Pt], eps: float) -> List[Pt]:
    if len(line) < 3:
        return line
    (x0, y0), (x1, y1) = line[0], line[-1]
    dx, dy = x1 - x0, y1 - y0
    length = math.hypot(dx, dy)
    far, fi = -1.0, 0
    for i in range(1, len(line) - 1):
        px, py = line[i]
        d = abs(dy * (px - x0) - dx * (py - y0)) / length if length > 1e-12 else math.dist(line[i], line[0])
        if d > far:
            far, fi = d, i
    if far <= eps:
        return [line[0], line[-1]]
    return _dp(line[:fi + 1], eps)[:-1] + _dp(line[fi:], eps)


def _ccw(poly: Sequence[Pt]) -> List[Pt]:
    return list(poly) if area(poly) >= 0 else list(reversed(poly))


def _reflex(poly: Sequence[Pt]) -> List[int]:
    """Indices of the inside (reflex) corners of a counter-clockwise outline."""
    n = len(poly)
    out = []
    for i in range(n):
        a, b, c = poly[i - 1], poly[i], poly[(i + 1) % n]
        if (b[0] - a[0]) * (c[1] - b[1]) - (b[1] - a[1]) * (c[0] - b[0]) < 0:
            out.append(i)
    return out


def _round(poly: Sequence[Pt]) -> Optional[float]:
    """The diameter when the outline is a circle, else None."""
    c = centroid(poly)
    radii = [math.dist(c, p) for p in poly]
    mean = sum(radii) / len(radii)
    if mean <= 0 or (max(radii) - min(radii)) / mean > 2.0 * ROUND_TOLERANCE:
        return None
    return 2.0 * mean


def resample(poly: Sequence[Pt], step: float) -> List[Pt]:
    """The outline with points no farther apart than `step` (a straight edge arrives as its two ends only)."""
    out: List[Pt] = []
    n = len(poly)
    for i in range(n):
        a, b = poly[i], poly[(i + 1) % n]
        k = max(1, int(math.ceil(math.dist(a, b) / step)))
        out.extend((a[0] + (b[0] - a[0]) * j / k, a[1] + (b[1] - a[1]) * j / k) for j in range(k))
    return out


def classify_section(outer: Sequence[Pt], inners: Sequence[Sequence[Pt]] = ()) -> Dict[str, Any]:
    """
    The stock form and size of a section from its outlines. Sizes are in mm: od and wall for round tube, width (the long side), height and wall
    for square and rectangular tube, width and height for bars and structural sections (with a nominal thickness, twice the area over the
    outline length, for the open sections), across_flats for hex bar.
    """
    outer = _ccw(outer)
    inners = [_ccw(h) for h in inners if len(h) >= 3]
    span = max(max(p[0] for p in outer) - min(p[0] for p in outer), max(p[1] for p in outer) - min(p[1] for p in outer), 1e-6)
    dense_outer = resample(outer, span / 100.0)
    dense_inners = [resample(h, span / 100.0) for h in inners]
    gross = area(outer)
    net = gross - sum(area(h) for h in inners)
    length = perimeter(outer) + sum(perimeter(h) for h in inners)
    long_side, short_side, _ = min_area_rect(outer)
    out: Dict[str, Any] = {
        "stock_form": "GENERIC_EXTRUSION",
        "area_mm2": round(net, 3),
        "perimeter_mm": round(length, 3),
        "outer_perimeter_mm": round(perimeter(outer), 3),
        "width_mm": round(long_side, 3),
        "height_mm": round(short_side, 3),
        "circumscribing_diameter_mm": round(enclosing_circle_diameter(outer), 3),
        "hollows": len(inners),
    }
    od = _round(dense_outer)
    if od is not None:
        if not inners:
            return {**out, "stock_form": "ROUND_BAR", "od_mm": round(od, 3), "width_mm": round(od, 3), "height_mm": round(od, 3)}
        if len(inners) == 1:
            idia = _round(dense_inners[0])
            if idia is not None and math.dist(centroid(outer), centroid(inners[0])) < 0.05 * od:
                return {**out, "stock_form": "ROUND_TUBE", "od_mm": round(od, 3), "id_mm": round(idia, 3), "wall_mm": round((od - idia) / 2.0, 3),
                        "width_mm": round(od, 3), "height_mm": round(od, 3)}
        return out
    fill = gross / (long_side * short_side) if long_side * short_side > 0 else 0.0
    if fill >= RECT_FILL:
        square = (long_side - short_side) / long_side <= SQUARE_TOLERANCE
        if not inners:
            return {**out, "stock_form": "SQUARE_BAR" if square else "RECTANGULAR_BAR"}
        if len(inners) == 1:
            il, ishort, _ = min_area_rect(inners[0])
            if area(inners[0]) / max(il * ishort, 1e-9) >= RECT_FILL:
                wall = ((long_side - il) + (short_side - ishort)) / 4.0
                return {**out, "stock_form": "SQUARE_TUBE" if square else "RECTANGULAR_TUBE", "wall_mm": round(wall, 3)}
        return out
    if inners:
        return out
    simple = simplify(outer, SIMPLIFY_FRACTION * long_side)
    simple = _ccw(simple)
    n = len(simple)
    reflex = _reflex(simple)
    if not reflex:
        if n == 6 and HEX_FILL[0] <= fill <= HEX_FILL[1]:
            sides = [math.dist(simple[i], simple[(i + 1) % n]) for i in range(n)]
            if (max(sides) - min(sides)) / max(sides) <= 0.05:
                return {**out, "stock_form": "HEX_BAR", "across_flats_mm": round(short_side, 3)}
        return out
    thickness = round(2.0 * gross / perimeter(outer), 3)
    r = len(reflex)
    if n == 6 and r == 1:
        return {**out, "stock_form": "ANGLE_BAR", "thickness_mm": thickness}
    if n == 8 and r == 2:
        adjacent = (reflex[1] - reflex[0]) % n in (1, n - 1)
        return {**out, "stock_form": "CHANNEL_BAR" if adjacent else "T_BEAM", "thickness_mm": thickness}
    if n == 12 and r == 4:
        return {**out, "stock_form": "I_BEAM", "thickness_mm": thickness}
    return out


def distance_to_outlines(p: Pt, outlines: Sequence[Sequence[Pt]]) -> float:
    """The distance from a point to the nearest outline segment."""
    best = math.inf
    for poly in outlines:
        n = len(poly)
        for i in range(n):
            a, b = poly[i], poly[(i + 1) % n]
            dx, dy = b[0] - a[0], b[1] - a[1]
            ll = dx * dx + dy * dy
            t = 0.0 if ll < 1e-18 else max(0.0, min(1.0, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / ll))
            d = math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy))
            if d < best:
                best = d
    return best
