"""Copper reverse engineering: nets, component pins, mount type, series chains, spacing, copper area, vias.

Everything here is read from the copper layers, the drill file and the Pick Place positions; nothing is assumed about the
circuit. Two shapes on the same copper layer that touch are one conductor; a plated hole joins the conductors it passes
through on every copper layer (through-holes: a blind or buried via cannot be told from a Gerber set and is reported as a
finding when there are more than two copper layers).

A part's pins are the copper pads (flashes) on its placement side that lie closer to its Pick Place centre than to any other
part's. That attribution is reported with medium confidence: a large part (a connector, a module) whose pads sit nearer to a
small neighbour can lose a pad to it, and parts left with fewer than two pads are listed instead of guessed.
"""
from __future__ import annotations

import math
from collections import Counter, defaultdict
from dataclasses import dataclass, field
from typing import Any

from gerbonara import GerberFile
from gerbonara.utils import MM

from extraction.geometry import Grid, Shape, UnionFind, capsule, connect, contains_point, gap, min_clearance, polygon, rectangle, union_area
from extraction.placements import Component
from parsers.excellon import Hole

ARC_STEP_RAD = math.radians(10.0)
CLEARANCE_SEARCH_MM = 1.0
AREA_STEP_MM = 0.05
DECIMALS = 3


class ClearPolarity(ValueError):
    """The layer subtracts copper (clear polarity); conductors cannot be traced from dark objects alone."""


@dataclass
class CopperLayer:
    name: str  # file name
    side: str  # "top" | "bottom" | inner label
    shapes: list[Shape]


@dataclass
class Analysis:
    copper: dict[str, Any] = field(default_factory=dict)
    connectivity: dict[str, Any] | None = None
    min_spacing: tuple[float, str] | None = None  # (mm, layer file)
    min_annular_ring_mm: float | None = None
    min_copper_to_edge_mm: float | None = None
    mount: dict[str, tuple[str, int]] = field(default_factory=dict)  # footprint -> (smd|tht, pins per part)
    findings: list[tuple[str, str, str]] = field(default_factory=list)  # (severity, message, field)
    unresolved: list[tuple[str, str]] = field(default_factory=list)


# ---------------------------------------------------------------------------------------------------- shapes
def _arc_points(x1, y1, x2, y2, cx, cy, clockwise) -> list[tuple[float, float]]:
    r = math.hypot(x1 - cx, y1 - cy)
    a1, a2 = math.atan2(y1 - cy, x1 - cx), math.atan2(y2 - cy, x2 - cx)
    if clockwise:
        while a2 >= a1 - 1e-12:
            a2 -= 2 * math.pi
    else:
        while a2 <= a1 + 1e-12:
            a2 += 2 * math.pi
    n = max(2, math.ceil(abs(a2 - a1) / ARC_STEP_RAD))
    return [(cx + r * math.cos(a1 + (a2 - a1) * k / n), cy + r * math.sin(a1 + (a2 - a1) * k / n)) for k in range(n + 1)]


def copper_shapes(file: GerberFile, layer: str) -> list[Shape]:
    """Every dark copper object of the layer as capsules and polygons, in mm. Clear polarity is refused."""
    shapes: list[Shape] = []
    for obj in file.objects:
        flash = type(obj).__name__ == "Flash"
        if not obj.polarity_dark:
            raise ClearPolarity(f"{layer}: clear polarity")
        for p in obj.to_primitives(MM):
            kind = type(p).__name__
            if not p.polarity_dark:
                raise ClearPolarity(f"{layer}: a primitive with clear polarity")
            if kind == "Circle":
                shapes.append(capsule(p.x, p.y, p.x, p.y, p.r, layer, flash))
            elif kind == "Line":
                shapes.append(capsule(p.x1, p.y1, p.x2, p.y2, p.width / 2, layer, flash))
            elif kind == "Rectangle":
                shapes.append(rectangle(p.x, p.y, p.w, p.h, p.rotation, layer, flash))
            elif kind == "Arc":
                pts = _arc_points(p.x1, p.y1, p.x2, p.y2, p.cx, p.cy, p.clockwise)
                shapes.extend(capsule(*a, *b, p.width / 2, layer, flash) for a, b in zip(pts, pts[1:]))
            elif kind == "ArcPoly":
                pts: list[tuple[float, float]] = []
                for a, b, (clockwise, center) in p.segments:
                    if clockwise is None:
                        pts.append(a)
                    else:
                        pts.extend(_arc_points(*a, *b, *center, clockwise)[:-1])
                if len(pts) >= 3:
                    shapes.append(polygon(pts, layer, flash))
            else:
                raise ClearPolarity(f"{layer}: primitive {kind} is not traced")
    return shapes


# ---------------------------------------------------------------------------------------------------- analysis
def analyse(layers: list[CopperLayer], holes: list[Hole], components: list[Component] | None,
            outline_segments: list[tuple[float, float, float, float]]) -> Analysis:
    result = Analysis()
    shapes: list[Shape] = [s for layer in layers for s in layer.shapes]
    if not shapes:
        result.unresolved.append(("connectivity", "the copper layers hold no drawn copper"))
        return result
    layer_of_file = {layer.name: layer for layer in layers}

    # ---- conductors on each layer, joined through plated holes ---------------------------------------------
    uf = connect(shapes)
    grid = Grid(shapes)
    hole_hits: list[tuple[Hole, list[int]]] = []
    for hole in holes:
        if not hole.plated:
            continue
        hits = [i for i in grid.near(hole.x_mm, hole.y_mm, hole.x_mm, hole.y_mm) if contains_point(shapes[i], hole.x_mm, hole.y_mm)]
        hole_hits.append((hole, hits))
        for i in hits[1:]:
            uf.union(hits[0], i)
    net_of = [uf.find(i) for i in range(len(shapes))]
    if len(layers) > 2:
        result.findings.append(("info", "more than two copper layers: every plated hole is taken as a through-hole; blind and buried vias are not in a Gerber set", "connectivity"))
    unlanded = sum(1 for _, hits in hole_hits if not hits)
    if unlanded:
        result.findings.append(("warning", f"{unlanded} plated hole(s) land on no copper", "connectivity"))

    # ---- copper area per layer, and spacing --------------------------------------------------------------
    for layer in layers:
        result.copper.setdefault("areaMm2", {})[layer.side] = round(union_area(layer.shapes, AREA_STEP_MM), 1)
    best: tuple[float, str] | None = None
    for layer in layers:
        idx = [i for i, s in enumerate(shapes) if s.layer == layer.name]
        found = min_clearance([shapes[i] for i in idx], [net_of[i] for i in idx], CLEARANCE_SEARCH_MM)
        if found and (best is None or found[0] < best[0]):
            best = (found[0], layer.name)
    if best is not None:
        result.min_spacing = (round(max(best[0], 0.0), DECIMALS), best[1])
    else:
        result.unresolved.append(("fabrication.minSpacingMm", f"no two conductors of different nets come within {CLEARANCE_SEARCH_MM} mm"))

    # ---- annular ring and copper to the board edge --------------------------------------------------------
    rings: list[float] = []
    for hole, hits in hole_hits:
        pads = [shapes[i] for i in hits if shapes[i].flash]
        if pads:
            rings.append((max(p.min_width() for p in pads) - hole.diameter_mm) / 2)
    if rings:
        result.min_annular_ring_mm = round(min(rings), DECIMALS)
    if outline_segments:
        edges = [capsule(*seg, 0.0) for seg in outline_segments]
        edge_grid = Grid(edges, cell=5.0)
        nearest = None
        for s in shapes:
            x0, y0, x1, y1 = s.bbox()
            for j in edge_grid.near(x0 - 5, y0 - 5, x1 + 5, y1 + 5):
                d = gap(s, edges[j])
                nearest = d if nearest is None else min(nearest, d)
        if nearest is not None:
            result.min_copper_to_edge_mm = round(max(nearest, 0.0), DECIMALS)

    # ---- pins, mount type, nets, chains ------------------------------------------------------------------
    sites = _pin_sites(shapes, layers, hole_hits)
    if components:
        pins = _attribute_sites(sites, components)
        owned = {k for ks in pins.values() for k in ks}
        result.copper["viaCount"] = sum(1 for k, site in enumerate(sites) if site.holed and k not in owned)
        mounts: dict[str, Counter] = defaultdict(Counter)
        for comp in components:
            ks = pins.get(comp.designator, [])
            if len(ks) < 2:  # a fiducial or a mechanical part: no mount type to read
                continue
            holed = sum(1 for k in ks if sites[k].holed)
            kind = "tht" if holed == len(ks) else ("smd" if holed == 0 else "mixed")
            mounts[comp.footprint][(kind, len(ks))] += 1
        for footprint, seen in mounts.items():
            (kind, n), _ = seen.most_common(1)[0]
            if len(seen) > 1 or kind == "mixed":
                result.findings.append(("warning", f"footprint {footprint}: parts read as {', '.join(f'{k} {p}-pin x{c}' for (k, p), c in seen.items())}; mount type left unknown", "thtParts"))
                continue
            result.mount[footprint] = (kind, n)
        padless = sorted(c.designator for c in components if len(pins.get(c.designator, [])) < 2)
        if padless:
            result.findings.append(("info", f"{len(padless)} placement(s) have fewer than two copper pins of their own (fiducials, mechanical parts): {', '.join(padless[:12])}", "connectivity"))
        pin_net = {d: [net_of[sites[k].shapes[0]] for k in ks] for d, ks in pins.items()}
        result.connectivity = _chains(components, pin_net)
    else:
        result.unresolved.append(("connectivity", "nets are traced but cannot be tied to parts without Pick Place positions"))
        result.copper["viaCount"] = sum(1 for site in sites if site.holed)
    result.copper["conductors"] = len(set(net_of))
    return result


@dataclass
class Site:
    x: float
    y: float
    shapes: list[int]
    holed: bool
    side: str | None  # None: a plated hole, reachable from either side


def _pin_sites(shapes: list[Shape], layers: list[CopperLayer], hole_hits) -> list[Site]:
    """One site per plated hole that lands on pads, and one per pad no hole passes through."""
    side_of = {layer.name: layer.side for layer in layers}
    sites: list[Site] = []
    pierced: set[int] = set()
    for hole, hits in hole_hits:
        pads = [i for i in hits if shapes[i].flash]
        if pads:
            sites.append(Site(hole.x_mm, hole.y_mm, pads, True, None))
            pierced.update(pads)
    for i, s in enumerate(shapes):
        if s.flash and i not in pierced and side_of.get(s.layer) in ("top", "bottom"):
            x, y = s.center()
            sites.append(Site(x, y, [i], False, side_of[s.layer]))
    return sites


PATTERN_STEP_MM = 0.1
NEAREST_LIMIT_MM = 15.0


def _attribute_sites(sites: list[Site], components: list[Component]) -> dict[str, list[int]]:
    """Each site goes to the nearest part that can reach it; then, per footprint, only the pad offsets that recur on
    at least half of its parts are kept. The recurring offsets are the footprint's pad pattern; a via or a stray pad
    that happens to sit near one part does not recur and is dropped."""
    cell = 5.0
    cgrid: dict[tuple[int, int], list[Component]] = defaultdict(list)
    for c in components:
        cgrid[(math.floor(c.x_mm / cell), math.floor(c.y_mm / cell))].append(c)
    nearest: dict[str, list[int]] = defaultdict(list)
    for k, site in enumerate(sites):
        gx, gy = math.floor(site.x / cell), math.floor(site.y / cell)
        best: tuple[float, Component] | None = None
        for ring in range(0, 4):
            for dx in range(-ring, ring + 1):
                for dy in range(-ring, ring + 1):
                    if max(abs(dx), abs(dy)) != ring:
                        continue
                    for c in cgrid.get((gx + dx, gy + dy), ()):
                        if site.side is not None and c.side != site.side:
                            continue
                        d = math.hypot(c.x_mm - site.x, c.y_mm - site.y)
                        if best is None or d < best[0]:
                            best = (d, c)
            if best is not None and best[0] <= ring * cell:
                break
        if best is not None and best[0] <= NEAREST_LIMIT_MM:
            nearest[best[1].designator].append(k)

    by_designator = {c.designator: c for c in components}

    def offset(c: Component, site: Site) -> tuple[int, int]:
        a = -math.radians(c.rotation_deg)
        dx, dy = site.x - c.x_mm, site.y - c.y_mm
        lx, ly = dx * math.cos(a) - dy * math.sin(a), dx * math.sin(a) + dy * math.cos(a)
        return (round(lx / PATTERN_STEP_MM), round(ly / PATTERN_STEP_MM))

    instances: dict[tuple[str, str], list[str]] = defaultdict(list)
    for c in components:
        instances[(c.footprint, c.side)].append(c.designator)
    pins: dict[str, list[int]] = {}
    for (_fp, _side), members in instances.items():
        votes: Counter[tuple[int, int]] = Counter()
        for d in members:
            votes.update({offset(by_designator[d], sites[k]) for k in nearest.get(d, [])})
        need = max(1, math.ceil(len(members) / 2))
        pattern = {o for o, n in votes.items() if n >= need}
        # tolerate one grid step of rounding at the boundary
        def matches(o: tuple[int, int]) -> bool:
            return any(abs(o[0] - p[0]) <= 1 and abs(o[1] - p[1]) <= 1 for p in pattern)
        for d in members:
            kept = [k for k in nearest.get(d, []) if matches(offset(by_designator[d], sites[k]))]
            # A part with two or more surface pads is surface-mount: a plated hole beside or inside it is a via, not a pin.
            # (With a single part of a footprint there are no other parts to learn its pad pattern from, so this is what
            # keeps a neighbouring via out of it.)
            surface = [k for k in kept if not sites[k].holed]
            pins[d] = surface if len(surface) >= 2 else kept
    return pins


def _chains(components: list[Component], pin_net: dict[str, list[int]]) -> dict[str, Any]:
    """Nets with their pin counts, and series chains: runs of two-pin parts joined by nets that carry exactly two pins."""
    comp_nets: dict[str, list[int]] = {}
    net_pins: Counter[int] = Counter()
    pin_total = 0
    for c in components:
        nets_of_pins = pin_net.get(c.designator, [])
        if len(nets_of_pins) < 2:
            continue
        pin_total += len(nets_of_pins)
        nets = sorted(set(nets_of_pins))
        comp_nets[c.designator] = nets
        for n in nets_of_pins:
            net_pins[n] += 1
    footprint = {c.designator: c.footprint for c in components}
    two_pin = {d: n for d, n in comp_nets.items() if len(n) == 2}
    shorted = [d for d, n in comp_nets.items() if len(n) == 1]
    adjacency: dict[int, list[str]] = defaultdict(list)
    for d, (a, b) in two_pin.items():
        adjacency[a].append(d)
        adjacency[b].append(d)
    is_link = lambda n: net_pins[n] == 2  # an internal node of a series chain
    seen: set[str] = set()
    chains: list[dict[str, Any]] = []
    for start, parts in two_pin.items():
        if start in seen:
            continue
        # walk both ways from this part while the joining net carries exactly two pins
        chain = [start]
        seen.add(start)
        ends = []
        for direction in (0, 1):
            net = two_pin[start][direction]
            prev = start
            while is_link(net):
                nxt = [d for d in adjacency[net] if d != prev and d in two_pin and d not in seen]
                if not nxt:
                    break
                prev = nxt[0]
                seen.add(prev)
                chain.insert(0, prev) if direction == 0 else chain.append(prev)
                a, b = two_pin[prev]
                net = b if a == net else a
            ends.append(net)
        if len(chain) >= 2:
            chains.append({"parts": chain, "ends": tuple(sorted(ends))})
    groups: Counter[tuple] = Counter()
    for ch in chains:
        composition = tuple(sorted(Counter(footprint[d] for d in ch["parts"]).items()))
        groups[(len(ch["parts"]), composition)] += 1
    end_nets = Counter(n for ch in chains for n in ch["ends"])
    rails = [n for n, k in end_nets.most_common() if k >= 2]
    summary: dict[str, Any] = {
        "netsWithPins": len(net_pins),
        "pins": pin_total,
        "largestNetPins": max(net_pins.values()) if net_pins else 0,
        "seriesChains": [
            {"count": count, "partsPerChain": length, "composition": [{"footprint": fp, "count": n} for fp, n in comp]}
            for (length, comp), count in sorted(groups.items(), key=lambda kv: -kv[1])
        ],
        "chainEndNets": len(rails),
    }
    if shorted:
        summary["shortedParts"] = sorted(shorted)[:50]
    return summary
