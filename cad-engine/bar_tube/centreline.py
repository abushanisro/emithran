"""
The centreline of a bar or tube: straights joined by bends, in order from one end to the other.

A bent tube is bought straight and bent; what the bender does is read off its centreline: each bend's centreline radius (CLR) and angle, the
straight between bends (the bender needs a minimum grip on it), and how far the tube turns about its own axis between bends (the clock angle,
the plane rotation a CNC bender makes). The cut length bought is the developed length: the straights plus the bend arcs.

A bend is an arc: a centre, the axis it turns about, a radius and an angle range [t0, t1] measured about the axis from `x` (with y = axis x x).
Bends come from the solid (a torus face for a round section, coaxial partial cylinders for any other); the straights are what joins their ends:
two arc ends face each other along a common line. The free ends run straight out to the end of the part.

Every point of the part is located on the centreline (`locate`): the nearest segment, the distance along the developed length, and the section
frame there (u, v across the stock, t along it), carried along the centreline from the first end, so the cross-section cut at one place maps
every other place's points into the same 2D frame.
"""
from __future__ import annotations

import math
from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional, Sequence, Tuple

from injection_molding.recognition.vec import Vec, cross, dot, norm, scale, sub, unit

TWO_PI = 2.0 * math.pi


def add(a: Vec, b: Vec) -> Vec:
    return (a[0] + b[0], a[1] + b[1], a[2] + b[2])


def rotate(v: Vec, axis: Vec, angle: float) -> Vec:
    """Rodrigues: v turned by `angle` (radians) about the unit `axis`."""
    c, s = math.cos(angle), math.sin(angle)
    k = axis
    kxv = cross(k, v)
    kdv = dot(k, v)
    return (v[0] * c + kxv[0] * s + k[0] * kdv * (1 - c),
            v[1] * c + kxv[1] * s + k[1] * kdv * (1 - c),
            v[2] * c + kxv[2] * s + k[2] * kdv * (1 - c))


@dataclass
class Bend:
    centre: Vec
    axis: Vec            # unit
    x: Vec               # unit, normal to axis; angles are measured from it about the axis
    radius: float        # the centreline radius (CLR), mm
    t0: float            # radians, t0 < t1
    t1: float
    face_ids: List[int] = field(default_factory=list)
    section_radius: float = 0.0   # half the section's largest size, as the bend faces show it (to search along a free end)
    source: str = "torus"

    @property
    def y(self) -> Vec:
        return cross(self.axis, self.x)

    @property
    def sweep(self) -> float:
        return self.t1 - self.t0

    def point(self, t: float) -> Vec:
        return add(self.centre, add(scale(self.x, self.radius * math.cos(t)), scale(self.y, self.radius * math.sin(t))))

    def tangent(self, t: float) -> Vec:
        """The direction of increasing t."""
        return unit(add(scale(self.x, -math.sin(t)), scale(self.y, math.cos(t))))

    def closed(self) -> bool:
        return self.sweep >= TWO_PI - 1e-3


@dataclass
class Segment:
    kind: str                 # "straight" | "bend"
    start: float              # mm along the developed length
    length: float
    # straight
    origin: Vec = (0.0, 0.0, 0.0)
    direction: Vec = (1.0, 0.0, 0.0)
    # bend
    bend: Optional[Bend] = None
    forward: bool = True      # True: travelled with increasing t
    # the section frame at the segment's start
    u: Vec = (0.0, 0.0, 0.0)
    v: Vec = (0.0, 0.0, 0.0)

    def t_at(self, s: float) -> float:
        b = self.bend
        assert b is not None
        a = s / b.radius
        return b.t0 + a if self.forward else b.t1 - a

    def point(self, s: float) -> Vec:
        if self.kind == "straight":
            return add(self.origin, scale(self.direction, s))
        assert self.bend is not None
        return self.bend.point(self.t_at(s))

    def tangent(self, s: float) -> Vec:
        if self.kind == "straight":
            return self.direction
        assert self.bend is not None
        t = self.bend.tangent(self.t_at(s))
        return t if self.forward else scale(t, -1.0)

    def frame(self, s: float) -> Tuple[Vec, Vec, Vec]:
        """(u, v, t) at distance s into the segment."""
        if self.kind == "straight":
            return self.u, self.v, self.direction
        assert self.bend is not None
        ang = (s / self.bend.radius) * (1.0 if self.forward else -1.0)
        return rotate(self.u, self.bend.axis, ang), rotate(self.v, self.bend.axis, ang), self.tangent(s)


@dataclass
class Located:
    segment: int
    s: float               # into the segment
    station: float         # along the developed length
    point: Vec             # on the centreline
    u: Vec
    v: Vec
    t: Vec
    beyond: float          # how far past an end of the centreline the point lies along t (0 inside)
    distance: float        # from the centreline point


@dataclass
class Centreline:
    segments: List[Segment]
    closed: bool = False

    @property
    def length(self) -> float:
        return sum(s.length for s in self.segments)

    def bends(self) -> List[Segment]:
        return [s for s in self.segments if s.kind == "bend"]

    def locate(self, p: Vec) -> Located:
        best: Optional[Located] = None
        last = len(self.segments) - 1
        for i, seg in enumerate(self.segments):
            if seg.kind == "straight":
                raw = dot(sub(p, seg.origin), seg.direction)
                s = min(max(raw, 0.0), seg.length)
                beyond = 0.0
                if not self.closed and i == 0 and raw < 0:
                    beyond = -raw
                if not self.closed and i == last and raw > seg.length:
                    beyond = raw - seg.length
            else:
                b = seg.bend
                assert b is not None
                rel = sub(p, b.centre)
                planar = sub(rel, scale(b.axis, dot(rel, b.axis)))
                ang = math.atan2(dot(planar, b.y), dot(planar, b.x))
                # Into [t0, t0 + 2 pi), then clamp to the arc (to whichever end is nearer when outside).
                while ang < b.t0:
                    ang += TWO_PI
                while ang >= b.t0 + TWO_PI:
                    ang -= TWO_PI
                if ang > b.t1:
                    ang = b.t1 if (ang - b.t1) < (b.t0 + TWO_PI - ang) else b.t0
                s = (ang - b.t0) * b.radius if seg.forward else (b.t1 - ang) * b.radius
                beyond = 0.0
            c = seg.point(s)
            u, v, t = seg.frame(s)
            d = norm(sub(p, c))
            if best is None or d < best.distance - 1e-9:
                best = Located(i, s, seg.start + s, c, u, v, t, beyond, d)
        assert best is not None
        return best

    def to_section(self, p: Vec) -> Tuple[Tuple[float, float], Located]:
        """The point in the section's 2D frame at its place on the centreline."""
        loc = self.locate(p)
        rel = sub(p, loc.point)
        return (dot(rel, loc.u), dot(rel, loc.v)), loc


def _initial_frame(t: Vec) -> Tuple[Vec, Vec]:
    """A section frame across direction t: u normal to t (from the world axis least along t), v = t x u."""
    axes = ((1.0, 0.0, 0.0), (0.0, 1.0, 0.0), (0.0, 0.0, 1.0))
    a = min(axes, key=lambda e: abs(dot(e, t)))
    u = unit(sub(a, scale(t, dot(a, t))))
    return u, cross(t, u)


def straight_centreline(origin: Vec, direction: Vec, length: float) -> Centreline:
    d = unit(direction)
    u, v = _initial_frame(d)
    return Centreline([Segment("straight", 0.0, length, origin=origin, direction=d, u=u, v=v)])


def chain_bends(bends: Sequence[Bend], vertices: Sequence[Vec], tol: float) -> Optional[Centreline]:
    """
    Join the bends into one centreline: two arc ends that face each other along a common line are joined by the straight between them; the free
    ends run straight out as far as the part goes (the farthest vertex near the line). None when the bends do not form one chain.
    """
    if not bends:
        return None
    if len(bends) == 1 and bends[0].closed():
        b = bends[0]
        t = b.tangent(b.t0)
        u, v = _initial_frame(t)
        return Centreline([Segment("bend", 0.0, b.radius * b.sweep, bend=b, forward=True, u=u, v=v)], closed=True)

    # Each arc end: (bend index, which end, point, outward direction).
    ends: List[Tuple[int, int, Vec, Vec]] = []
    for i, b in enumerate(bends):
        ends.append((i, 0, b.point(b.t0), scale(b.tangent(b.t0), -1.0)))
        ends.append((i, 1, b.point(b.t1), b.tangent(b.t1)))
    angle_tol = math.cos(math.radians(2.0))
    pairs: List[Tuple[float, int, int]] = []
    for a in range(len(ends)):
        for c in range(a + 1, len(ends)):
            ia, _, pa, da = ends[a]
            ic, _, pc, dc = ends[c]
            if ia == ic:
                continue
            if dot(da, dc) > -angle_tol:  # they must face each other
                continue
            gap = sub(pc, pa)
            g = norm(gap)
            if g > tol and dot(scale(gap, 1.0 / g), da) < angle_tol:
                continue
            pairs.append((g, a, c))
    pairs.sort()
    partner: Dict[int, Tuple[int, float]] = {}
    for g, a, c in pairs:
        if a in partner or c in partner:
            continue
        partner[a] = (c, g)
        partner[c] = (a, g)

    free = [k for k in range(len(ends)) if k not in partner]
    closed = not free
    if closed:
        start_end = 0
    elif len(free) == 2:
        start_end = free[0]
    else:
        return None  # more than one chain

    max_section = max(b.section_radius for b in bends)
    reach = 2.0 * max_section + tol

    def run_out(p: Vec, d: Vec) -> float:
        far = 0.0
        for q in vertices:
            rel = sub(q, p)
            s = dot(rel, d)
            if s <= 0:
                continue
            if norm(sub(rel, scale(d, s))) <= reach and s > far:
                far = s
        return far

    segments: List[Segment] = []
    station = 0.0
    k = start_end
    if not closed:
        _, _, p, d = ends[k]
        lead = run_out(p, d)
        # The lead straight is travelled toward the first bend: it starts out at the part's end.
        segments.append(Segment("straight", 0.0, lead, origin=add(p, scale(d, lead)), direction=scale(d, -1.0)))
        station = lead
    visited = 0
    while True:
        bi, which, _, _ = ends[k]
        b = bends[bi]
        forward = which == 0  # entering at t0 travels with increasing t
        segments.append(Segment("bend", station, b.radius * b.sweep, bend=b, forward=forward))
        station += b.radius * b.sweep
        visited += 1
        exit_k = k + 1 if which == 0 else k - 1
        _, _, pe, de = ends[exit_k]
        if exit_k in partner:
            nxt, gap = partner[exit_k]
            if gap > tol:
                segments.append(Segment("straight", station, gap, origin=pe, direction=de))
                station += gap
            if closed and nxt == start_end:
                break
            k = nxt
        else:
            tail = run_out(pe, de)
            segments.append(Segment("straight", station, tail, origin=pe, direction=de))
            break
        if visited > len(bends):
            return None
    if visited != len(bends):
        return None

    # Carry the section frame from the first end along the centreline.
    t0 = segments[0].tangent(0.0)
    u, v = _initial_frame(t0)
    for seg in segments:
        seg.u, seg.v = u, v
        u, v, _ = seg.frame(seg.length)
    return Centreline(segments, closed=closed)


def clock_angles(centreline: Centreline) -> List[float]:
    """Between each bend and the next, how far the tube turns about its own axis (degrees, 0 to 180): 0 bends on in the same plane and the same
    way, 180 the same plane the other way."""
    bends = centreline.bends()
    out: List[float] = []
    for a, b in zip(bends, bends[1:]):
        na = a.bend.axis if a.forward else scale(a.bend.axis, -1.0)  # type: ignore[union-attr]
        nb = b.bend.axis if b.forward else scale(b.bend.axis, -1.0)  # type: ignore[union-attr]
        c = max(-1.0, min(1.0, dot(na, nb)))
        out.append(round(math.degrees(math.acos(c)), 2))
    return out


def straights_between(centreline: Centreline) -> List[float]:
    """The straight before each bend (the first is the lead from the part's end), and the tail after the last."""
    out: List[float] = []
    run = 0.0
    for seg in centreline.segments:
        if seg.kind == "straight":
            run += seg.length
        else:
            out.append(round(run, 3))
            run = 0.0
    out.append(round(run, 3))
    return out


def describe_bends(centreline: Centreline) -> List[Dict[str, Any]]:
    clocks = clock_angles(centreline)
    straights = straights_between(centreline)
    out: List[Dict[str, Any]] = []
    for i, seg in enumerate(centreline.bends()):
        b = seg.bend
        assert b is not None
        out.append({
            "index": i,
            "clr_mm": round(b.radius, 3),
            "angle_deg": round(math.degrees(b.sweep), 3),
            "arc_length_mm": round(seg.length, 3),
            "straight_before_mm": straights[i],
            "clock_angle_deg": clocks[i - 1] if i > 0 else 0.0,
            "station_mm": round(seg.start, 3),
            "face_ids": sorted(b.face_ids),
            "source": b.source,
        })
    return out
