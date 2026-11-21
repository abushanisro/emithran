"""
What a hydroformed sheet-metal part's cost rests on, measured from the solid.

Hydroforming forms a flat blank against one tool with fluid pressure: Deep Draw (a round tool, deep parts) or Fluid Cell (a rubber
pad on a tray of form blocks, shallow and flanged parts). The blank is blanked and pierced on a press first (Offline Blank). So the
measures are the press axis, the form, the blank and the features formed or pierced in it (memory/Sheetmetal Hydroforming):

  normal              the main face's normal: the press axis the part is formed along.
  forming_depth_mm    the whole part's extent along the normal: how deep the tool forms it.
  plan                the part seen along the normal: the minimum-area rectangle around its outline (length, width) and its narrowest
                      caliper width. Depth over width is the ratio memory's fluidCellFormingRatioThreshold routes by (the engine does).
  projected_area_mm2  the area of the part's silhouette along the normal; openings through the silhouette (holes) are not counted.
  developed_area_mm2  the sheet's mid-surface area: half the area of every face that has an offset twin one thickness away (both skins
                      of the sheet), the same rule drawn_shell.py uses.
  main_surface        the main face: its area and the length of its outer boundary.
  drawn               the drawn form (a cup, a box, a dome) or null: its depth and opening width (drawn_shell.py), the area inside its
                      outline seen along the normal and the sheet it is made of. A form closes around the press axis: its faces run all
                      the way round a boundary of the main face (a cup's bottom radius round the bottom, a top hat's flange radius round
                      the flange's opening), or it stands off the main face (a dome). Double-curved sheet that follows only part of the
                      main face's edge is a curved flange, not a form.
  blank               the flat blank the part is formed from (method: true_unfold, the extractor's unfold of a bent part;
                      drawn_equal_area, the developed area of a drawn part laid out as the part's own outline scaled about its
                      centroid to that area, an exact circle when that outline is round; flat, the main face of a flat plate): its area
                      (holes cut), outline (enclosing the holes too), perimeter, minimum-area rectangle, smallest enclosing circle, and
                      the holes pierced in it (those through faces parallel to the main face).
  flanges             straight: each deduplicated bend outside the drawn form, with its angle, bend-line length and leg;
                      curved: each pair of twin tori about an axis parallel to the normal, against the main face and outside the
                      drawn form (a flange following a curved edge), with its edge radius (the torus's major radius), the length of
                      that edge, its angle and leg (from the cone or cylinder wall beyond it).
  holes               every cut through the sheet other than its outer boundary (a connected set of faces with no offset twin,
                      bounded by two closed loops on the sheet's skins): round ones (SimpleHole, with diameter), slots and other
                      cut-outs (ComplexHole), each with its perimeter and area, whether it is pierced in the flat blank, whether it
                      goes through the main face and how far its edge is from the main face's outer boundary.

These are measurements only. Which route, how many draws, the cycle, the tool and the cost are decided in the backend from the staged
reference. A value that cannot be measured is null, never estimated.
"""
from __future__ import annotations

import logging
import math
from typing import Any, Dict, Iterable, List, Optional, Sequence, Set, Tuple

from sheet_metal.features.drawn_shell import (
    _ANG_TOL,
    _POS_TOL,
    SILHOUETTE_DEFLECTION_MM,
    _cross,
    _dot,
    _min_width_2d,
    _same_axis,
    _unit,
    region_measures,
)
from shared.casting_geometry import projected_outline

logger = logging.getLogger(__name__)

VERSION = "hf_v1"

# Chord deflection an edge is sampled at for the area a hole's opening encloses: a 6 mm hole's polygon then holds its area to 0.05 %.
EDGE_DEFLECTION_MM = 0.001
# Chord deflection the loops of every cut are first sampled at, to tell the outer boundary and each hole's narrower opening apart and
# to read a cut-out's elongation (a 2 mm hole is then a 22-gon).
LOOP_DEFLECTION_MM = 0.01
# Chord deflection of a planar face's boundary in the silhouette and of a flat blank's outline (the mesh's 0.1 mm, refined tenfold:
# a 5 mm hole then reads within 0.5 % of its area).
OUTLINE_DEFLECTION_MM = 0.01
# A plane whose normal is within this cosine of perpendicular to a bend line contains the line: a wall of the bend.
PERPENDICULAR_TOL = 0.05
# A bore whose faces about one axis sweep a full turn less this closes on itself: a round hole.
FULL_TURN_TOL_RAD = 1e-3
# Elongation (minimum-area rectangle, long over short side) at or beyond which a cut-out is a slot: the sheet-metal extractor's own
# slot rule (feature_extractor._detect_slots_v2).
SLOT_ASPECT = 2.5
# Points on an exact-circle blank outline, one degree apart (the polygon's area is within 0.005 % of the circle's).
CIRCLE_POINTS = 360

Vec = Tuple[float, float, float]


# ── topology helpers ────────────────────────────────────────────────────────

def _face_index_map(shape: Any) -> Any:
    from OCC.Core.TopAbs import TopAbs_FACE  # type: ignore
    from OCC.Core.TopExp import TopExp_Explorer  # type: ignore
    from OCC.Core.TopTools import TopTools_IndexedMapOfShape  # type: ignore

    fmap = TopTools_IndexedMapOfShape()
    exp = TopExp_Explorer(shape, TopAbs_FACE)
    while exp.More():
        fmap.Add(exp.Current())
        exp.Next()
    return fmap


def _edge_face_map(shape: Any) -> Any:
    from OCC.Core.TopAbs import TopAbs_EDGE, TopAbs_FACE  # type: ignore
    from OCC.Core.TopExp import topexp  # type: ignore
    from OCC.Core.TopTools import TopTools_IndexedDataMapOfShapeListOfShape  # type: ignore

    emap = TopTools_IndexedDataMapOfShapeListOfShape()
    topexp.MapShapesAndAncestors(shape, TopAbs_EDGE, TopAbs_FACE, emap)
    return emap


def _edges(shape: Any) -> List[Any]:
    """The edges of a face or wire, each oriented as that face or wire runs it (degenerated edges left out)."""
    from OCC.Core.BRep import BRep_Tool  # type: ignore
    from OCC.Core.TopAbs import TopAbs_EDGE  # type: ignore
    from OCC.Core.TopExp import TopExp_Explorer  # type: ignore
    from OCC.Core.TopoDS import topods  # type: ignore

    out = []
    exp = TopExp_Explorer(shape, TopAbs_EDGE)
    while exp.More():
        e = topods.Edge(exp.Current())
        if not BRep_Tool.Degenerated(e):
            out.append(e)
        exp.Next()
    return out


def _wires(face: Any) -> List[Any]:
    from OCC.Core.TopAbs import TopAbs_WIRE  # type: ignore
    from OCC.Core.TopExp import TopExp_Explorer  # type: ignore
    from OCC.Core.TopoDS import topods  # type: ignore

    out = []
    exp = TopExp_Explorer(face, TopAbs_WIRE)
    while exp.More():
        out.append(topods.Wire(exp.Current()))
        exp.Next()
    return out


def _across(edge: Any, emap: Any, fmap: Any) -> Set[int]:
    """The faces an edge bounds (face indices)."""
    from OCC.Core.TopTools import TopTools_ListIteratorOfListOfShape  # type: ignore

    out: Set[int] = set()
    if not emap.Contains(edge):
        return out
    it = TopTools_ListIteratorOfListOfShape(emap.FindFromKey(edge))
    while it.More():
        j = fmap.FindIndex(it.Value()) - 1
        if j >= 0:
            out.add(j)
        it.Next()
    return out


def _length(shape: Any) -> float:
    from OCC.Core.BRepGProp import brepgprop  # type: ignore
    from OCC.Core.GProp import GProp_GProps  # type: ignore

    props = GProp_GProps()
    brepgprop.LinearProperties(shape, props)
    return props.Mass()


def _edge_points(edge: Any, deflection: float) -> List[Vec]:
    """Points along an edge, in the direction its face or wire runs it."""
    from OCC.Core.BRepAdaptor import BRepAdaptor_Curve  # type: ignore
    from OCC.Core.GCPnts import GCPnts_QuasiUniformDeflection  # type: ignore
    from OCC.Core.TopAbs import TopAbs_REVERSED  # type: ignore

    curve = BRepAdaptor_Curve(edge)
    sampler = GCPnts_QuasiUniformDeflection(curve, deflection)
    if sampler.IsDone() and sampler.NbPoints() >= 2:
        pts = [sampler.Value(i) for i in range(1, sampler.NbPoints() + 1)]
    else:
        pts = [curve.Value(curve.FirstParameter()), curve.Value(curve.LastParameter())]
    out = [(p.X(), p.Y(), p.Z()) for p in pts]
    return out[::-1] if edge.Orientation() == TopAbs_REVERSED else out


def _vector_area(edges: Iterable[Any], deflection: float) -> Tuple[Vec, List[Vec]]:
    """The vector area of a closed loop of consistently oriented edges (Newell: half the sum of p_k x p_k+1 along each edge;
    the edges meet end to start, so their order does not matter) and the loop's sample points. Its length is the area the loop
    encloses on the plane it is most open to (exact for a planar loop); its direction is that plane's normal."""
    ax = ay = az = 0.0
    pts_all: List[Vec] = []
    for e in edges:
        pts = _edge_points(e, deflection)
        pts_all.extend(pts)
        for p, q in zip(pts, pts[1:]):
            ax += p[1] * q[2] - p[2] * q[1]
            ay += p[2] * q[0] - p[0] * q[2]
            az += p[0] * q[1] - p[1] * q[0]
    return (ax / 2.0, ay / 2.0, az / 2.0), pts_all


def _norm(v: Vec) -> float:
    return math.sqrt(_dot(v, v))


def _plane_frame(normal: Vec) -> Tuple[Vec, Vec]:
    """The (u, v) frame the silhouette is measured in (shared.casting_geometry's, so outlines and silhouettes agree)."""
    from shared.casting_geometry import _plane_basis

    return _plane_basis(normal)  # type: ignore[return-value]


def _is_solid(shape: Any) -> bool:
    """The shape holds a solid: its boundary is closed, so its silhouette is that of its faces facing the axis."""
    from OCC.Core.TopAbs import TopAbs_SOLID  # type: ignore
    from OCC.Core.TopExp import TopExp_Explorer  # type: ignore

    return TopExp_Explorer(shape, TopAbs_SOLID).More()


def _rect_sides(geometry: Any) -> Tuple[float, float]:
    """Long and short side of the minimum-area rectangle around a shapely geometry."""
    import shapely  # type: ignore

    rect = shapely.minimum_rotated_rectangle(geometry)
    coords = list(rect.exterior.coords) if hasattr(rect, "exterior") else list(rect.coords)
    if len(coords) < 3:
        span = rect.length if hasattr(rect, "length") else 0.0
        return span, 0.0
    a = math.dist(coords[0], coords[1])
    b = math.dist(coords[1], coords[2])
    return max(a, b), min(a, b)


def _filled(geometry: Any) -> Any:
    """A silhouette with every opening filled: the area inside its outer outline."""
    from shapely.geometry import Polygon  # type: ignore
    from shapely.ops import unary_union  # type: ignore

    parts = list(geometry.geoms) if hasattr(geometry, "geoms") else [geometry]
    return unary_union([Polygon(p.exterior) for p in parts if hasattr(p, "exterior")])


def _r(x: Optional[float], nd: int) -> Optional[float]:
    return None if x is None else round(float(x), nd)


# ── the form and the flanges ────────────────────────────────────────────────

def _components(ids: Iterable[int], adjacency: Dict[int, set]) -> List[Set[int]]:
    """Connected sets of faces among ids (faces sharing an edge)."""
    pool = set(ids)
    out: List[Set[int]] = []
    while pool:
        start = pool.pop()
        comp = {start}
        stack = [start]
        while stack:
            i = stack.pop()
            for j in adjacency.get(i, ()):
                if j in pool:
                    pool.discard(j)
                    comp.add(j)
                    stack.append(j)
        out.append(comp)
    return out


def _split_drawn_region(region: Set[int], main_ids: Set[int], dom_wire_across: List[List[Set[int]]], adjacency: Dict[int, set],
                        partners: Dict[int, List[int]], is_main_plane) -> Tuple[Set[int], List[Set[int]]]:
    """The drawn region's faces that make the drawn form, and its parts that are curved flanges (see the module docstring).
    dom_wire_across: for each wire of the main face, the faces across each of its edges.
    A part is the faces joined by edges or as the two skins of the same sheet (offset twins): a cup's inner and outer skin
    meet only across its rim and bottom, which are not curved, yet are one form."""
    form: Set[int] = set()
    flange_parts: List[Set[int]] = []
    joined = {i: set(adjacency.get(i, ())) | set(partners.get(i, ())) for i in region}
    for comp in _components(region, joined):
        touches = any(adjacency.get(i, set()) & main_ids for i in comp)
        closes = False
        for wire in dom_wire_across:
            # An edge into another face of the main surface's own plane (an exporter's split of it) neither opens nor closes it.
            relevant = [acr for acr in wire if acr and not any(is_main_plane(j) for j in acr)]
            if relevant and all(acr & comp for acr in relevant):
                closes = True
                break
        if closes or not touches:
            form |= comp
        else:
            flange_parts.append(comp)
    return form, flange_parts


def _curved_flanges(part: Set[int], by_index: Dict[int, Dict[str, Any]], normal: Vec, main_ids: Set[int],
                    adjacency: Dict[int, set], fmap: Any, emap: Any) -> List[Dict[str, Any]]:
    tori = [by_index[i] for i in sorted(part)
            if by_index[i]["kind"] == "torus" and abs(abs(_dot(by_index[i]["dir"], normal)) - 1.0) <= _ANG_TOL]
    groups: List[List[Dict[str, Any]]] = []
    for t in tori:
        for g in groups:
            if _same_axis(g[0]["dir"], g[0]["point"], t["dir"], t["point"]) and abs(g[0]["major"] - t["major"]) <= _POS_TOL:
                g.append(t)
                break
        else:
            groups.append([t])
    out: List[Dict[str, Any]] = []
    for g in groups:
        ids = {t["index"] for t in g}
        if not any(adjacency.get(i, set()) & main_ids for i in ids):
            continue  # not against the main face: not a flange off its edge
        # The edge it follows: the edges the main face (or its twin skin) shares with these tori.
        edge_len = 0.0
        for m in main_ids:
            shared = sum(_length(e) for e in _edges(by_index[m]["face"]) if _across(e, emap, fmap) & ids)
            edge_len = max(edge_len, shared)
        walls = [by_index[i] for i in sorted(part)
                 if by_index[i]["kind"] in ("cylinder", "cone") and adjacency.get(i, set()) & ids
                 and _same_axis(g[0]["dir"], g[0]["point"], by_index[i]["dir"], by_index[i]["point"])]
        if walls:
            w = walls[0]
            angle = 90.0 if w["kind"] == "cylinder" else 90.0 - math.degrees(abs(w["adaptor"].Cone().SemiAngle()))
            height: Optional[float] = max(abs(x["adaptor"].LastVParameter() - x["adaptor"].FirstVParameter()) for x in walls)
        else:
            # No wall beyond the radius: the flange turns through the torus alone, by its tube's sweep.
            angle = math.degrees(max(abs(t["adaptor"].LastVParameter() - t["adaptor"].FirstVParameter()) for t in g))
            height = None
        out.append({
            "kind": "curved",
            "angle_deg": round(angle, 2),
            "length_mm": round(edge_len, 2),
            "height_mm": _r(height, 2),
            "edge_radius_mm": round(g[0]["major"], 2),
            "face_ids": sorted(ids | {w["index"] for w in walls}),
        })
    return out


def _face_distances(start: Iterable[int], adjacency: Dict[int, set]) -> Dict[int, int]:
    """Faces crossed from the main face (either of its skins) to each face (breadth first over shared edges)."""
    dist = {i: 0 for i in start}
    frontier = list(dist)
    while frontier:
        nxt = []
        for i in frontier:
            for j in adjacency.get(i, ()):
                if j not in dist:
                    dist[j] = dist[i] + 1
                    nxt.append(j)
        frontier = nxt
    return dist


def _straight_leg(bend: Dict[str, Any], by_index: Dict[int, Dict[str, Any]], twinned: Set[int], fmap: Any,
                  dist: Dict[int, int]) -> Optional[float]:
    """The flange's leg beyond a bend: the width of the wall on the bend's far side from the main face, in that wall's plane,
    across the bend line. A wall is a planar skin of the sheet (a face with an offset twin) along the bend line. None when the
    bend does not have walls on exactly two sides or both are as far from the main face."""
    from OCC.Core.BRepTools import breptools  # type: ignore

    axis = _unit(tuple(bend["dir"]))
    walls = []
    for f in bend.get("neighbor_faces") or []:
        rec = by_index.get(fmap.FindIndex(f) - 1)
        if rec and rec["index"] in twinned and rec["kind"] == "plane" and abs(_dot(rec["dir"], axis)) < PERPENDICULAR_TOL:
            walls.append(rec)
    sides: List[List[Dict[str, Any]]] = []
    for w in walls:
        for s in sides:
            if abs(abs(_dot(s[0]["dir"], w["dir"])) - 1.0) <= _ANG_TOL:
                s.append(w)
                break
        else:
            sides.append([w])
    if len(sides) != 2:
        return None
    d0 = min(dist.get(w["index"], math.inf) for w in sides[0])
    d1 = min(dist.get(w["index"], math.inf) for w in sides[1])
    if d0 == d1:
        return None
    far = sides[1] if d0 < d1 else sides[0]
    across = _unit(_cross(axis, far[0]["dir"]))
    leg = 0.0
    for w in far:
        pts = [p for e in _edges(breptools.OuterWire(w["face"])) for p in _edge_points(e, OUTLINE_DEFLECTION_MM)]
        if pts:
            along = [_dot(p, across) for p in pts]
            leg = max(leg, max(along) - min(along))
    return leg


# ── holes ───────────────────────────────────────────────────────────────────

def _holes(shape: Any, sheet_faces: Dict[str, Any], fmap: Any, emap: Any, dominant_face: Any, dom: int, main_ids: Set[int],
           normal: Vec) -> List[Dict[str, Any]]:
    import shapely  # type: ignore
    from OCC.Core.BRep import BRep_Builder  # type: ignore
    from OCC.Core.BRepExtrema import BRepExtrema_DistShapeShape  # type: ignore
    from OCC.Core.BRepTools import breptools  # type: ignore
    from OCC.Core.TopAbs import TopAbs_VERTEX  # type: ignore
    from OCC.Core.TopExp import topexp  # type: ignore
    from OCC.Core.TopoDS import TopoDS_Compound  # type: ignore
    from OCC.Core.TopTools import TopTools_IndexedMapOfShape  # type: ignore

    by_index, twinned, adjacency = sheet_faces["by_index"], sheet_faces["twinned"], sheet_faces["adjacency"]
    vmap = TopTools_IndexedMapOfShape()
    topexp.MapShapes(shape, TopAbs_VERTEX, vmap)

    candidates = []
    for comp in _components((i for i in by_index if i not in twinned), adjacency):
        # Where the cut meets the sheet: each edge between its faces and a skin, oriented as its own face runs it.
        boundary: List[Tuple[Any, int]] = []
        for i in comp:
            for e in _edges(by_index[i]["face"]):
                for j in _across(e, emap, fmap) - {i}:
                    if j in twinned:
                        boundary.append((e, j))
        if not boundary:
            continue
        # The edges form loops (joined at shared vertices); a cut through the sheet has one closed loop on each skin.
        parent = list(range(len(boundary)))

        def find(a: int) -> int:
            while parent[a] != a:
                parent[a] = parent[parent[a]]
                a = parent[a]
            return a

        ends = [(vmap.FindIndex(topexp.FirstVertex(e)), vmap.FindIndex(topexp.LastVertex(e))) for e, _ in boundary]
        first_at: Dict[int, int] = {}
        for k, (a, b) in enumerate(ends):
            for vid in (a, b):
                if vid in first_at:
                    parent[find(k)] = find(first_at[vid])
                else:
                    first_at[vid] = k
        loops: Dict[int, List[int]] = {}
        for k in range(len(boundary)):
            loops.setdefault(find(k), []).append(k)
        closed = True
        measured = []
        for members in loops.values():
            degree: Dict[int, int] = {}
            for k in members:
                for vid in ends[k]:
                    degree[vid] = degree.get(vid, 0) + 1
            if any(d % 2 for d in degree.values()):
                closed = False
                break
            vec, pts = _vector_area((boundary[k][0] for k in members), LOOP_DEFLECTION_MM)
            measured.append({
                "area": _norm(vec), "vec": vec, "pts": pts,
                "perimeter": sum(_length(boundary[k][0]) for k in members),
                "edge_skins": [boundary[k] for k in members], "skins": {boundary[k][1] for k in members},
            })
        if closed and measured:
            candidates.append((comp, measured))
    if not candidates:
        return []
    # The sheet's outer boundary is a cut too (its edge faces): the one whose loops enclose the most.
    outer = max(range(len(candidates)), key=lambda c: max(m["area"] for m in candidates[c][1]))

    holes: List[Dict[str, Any]] = []
    for c, (comp, loops_m) in enumerate(candidates):
        if c == outer or len(loops_m) != 2:
            continue
        rep = min(loops_m, key=lambda m: m["area"])  # the narrower opening: the cut through the sheet
        skins = set().union(*(m["skins"] for m in loops_m))
        in_flat = any(by_index[j]["kind"] == "plane" and abs(abs(_dot(by_index[j]["dir"], normal)) - 1.0) <= _ANG_TOL for j in skins)
        on_main = bool(skins & main_ids)

        diameter = None
        area = None
        cyls = sorted((by_index[i] for i in comp if by_index[i]["kind"] == "cylinder"), key=lambda r: r["radius"])
        if cyls:
            bore = [r for r in cyls if abs(r["radius"] - cyls[0]["radius"]) <= _POS_TOL
                    and _same_axis(cyls[0]["dir"], cyls[0]["point"], r["dir"], r["point"])]
            sweep = sum(abs(r["adaptor"].LastUParameter() - r["adaptor"].FirstUParameter()) for r in bore)
            if sweep >= 2.0 * math.pi - FULL_TURN_TOL_RAD:
                diameter = 2.0 * cyls[0]["radius"]
                # Opening on planes square to the bore: the circle itself.
                if all(by_index[j]["kind"] == "plane" and abs(abs(_dot(by_index[j]["dir"], cyls[0]["dir"])) - 1.0) <= _ANG_TOL
                       for j in rep["skins"]):
                    area = math.pi * cyls[0]["radius"] ** 2
        if area is None:
            area = _norm(_vector_area((e for e, _s in rep["edge_skins"]), EDGE_DEFLECTION_MM)[0])
        if diameter is not None:
            kind = "SimpleHole"
        else:
            n = _unit(rep["vec"]) if rep["area"] > 0 else normal
            u, v = _plane_frame(n)
            long_side, short_side = _rect_sides(shapely.MultiPoint([(_dot(p, u), _dot(p, v)) for p in rep["pts"]]))
            kind = "Slot" if short_side > 0 and long_side / short_side >= SLOT_ASPECT else "ComplexHole"

        edge_distance = None
        if on_main:
            for m in [dom] + sorted(main_ids - {dom}):
                edges = [e for lm in loops_m for e, s in lm["edge_skins"] if s == m]
                if not edges:
                    continue
                comp_shape = TopoDS_Compound()
                builder = BRep_Builder()
                builder.MakeCompound(comp_shape)
                for e in edges:
                    builder.Add(comp_shape, e)
                face = dominant_face if m == dom else by_index[m]["face"]
                ext = BRepExtrema_DistShapeShape(comp_shape, breptools.OuterWire(face))
                if ext.IsDone() and ext.NbSolution() > 0:
                    edge_distance = ext.Value()
                break

        holes.append({
            "feature_type": kind,
            "diameter_mm": _r(diameter, 2),
            "perimeter_mm": round(rep["perimeter"], 2),
            "area_mm2": round(area, 1),
            "in_flat": in_flat,
            "on_main_surface": on_main,
            "edge_distance_mm": _r(edge_distance, 2),
            "face_ids": sorted(comp),
        })
    holes.sort(key=lambda h: h["face_ids"][0])
    return holes


# ── the blank ───────────────────────────────────────────────────────────────

def _outline_measures(polygon: Any) -> Dict[str, Any]:
    import shapely  # type: ignore

    length, width = _rect_sides(polygon)
    return {
        "perimeter_mm": round(polygon.exterior.length, 2),
        "length_mm": round(length, 2),
        "width_mm": round(width, 2),
        # The smallest circle containing the outline (not twice the farthest point from the centroid).
        "circumscribed_diameter_mm": round(2.0 * shapely.minimum_bounding_radius(polygon), 2),
        "outline_points_mm": [[round(x, 3), round(y, 3)] for x, y in polygon.exterior.coords],
    }


def _is_round(polygon: Any) -> Optional[Tuple[Tuple[float, float], float]]:
    """(centre, radius) when the outline is a circle: every vertex (a mesh node, on the true outline) at one distance from the
    centroid within the silhouette mesh's deflection, and the area that of a circle less what that deflection can cut off."""
    c = polygon.centroid
    radii = [math.hypot(x - c.x, y - c.y) for x, y in polygon.exterior.coords]
    r = max(radii)
    if r <= 0:
        return None
    dev = 2.0 * SILHOUETTE_DEFLECTION_MM
    if r - min(radii) > dev:
        return None
    if polygon.area < math.pi * r * r * (1.0 - 2.0 * dev / r):
        return None
    return (c.x, c.y), r


def _drawn_blank(outline: Any, area_mm2: float, hole_area_mm2: float) -> Dict[str, Any]:
    """A drawn part's blank: the part's outline seen along the press axis, scaled about its centroid until it encloses the
    developed sheet and its holes. A round outline gives an exact circle, D0 = sqrt(4 A / pi)."""
    from shapely import affinity  # type: ignore
    from shapely.geometry import Polygon  # type: ignore

    target = area_mm2 + hole_area_mm2
    poly = max(list(outline.geoms), key=lambda p: p.area) if hasattr(outline, "geoms") else outline
    round_ = _is_round(poly)
    if round_ is not None:
        (cx, cy), _r0 = round_
        d0 = math.sqrt(4.0 * target / math.pi)
        circle = Polygon([(cx + d0 / 2 * math.cos(2 * math.pi * k / CIRCLE_POINTS), cy + d0 / 2 * math.sin(2 * math.pi * k / CIRCLE_POINTS))
                          for k in range(CIRCLE_POINTS)])
        out = _outline_measures(circle)
        out.update(perimeter_mm=round(math.pi * d0, 2), length_mm=round(d0, 2), width_mm=round(d0, 2), circumscribed_diameter_mm=round(d0, 2))
        return out
    scale = math.sqrt(target / poly.area) if poly.area > 0 else 1.0
    return _outline_measures(affinity.scale(poly, xfact=scale, yfact=scale, origin="centroid"))


def _flat_blank_outline(dominant_face: Any, normal: Vec) -> Optional[Any]:
    from OCC.Core.BRepTools import breptools  # type: ignore
    from shapely.geometry import Polygon  # type: ignore

    u, v = _plane_frame(normal)
    pts = [p for e in _edges(breptools.OuterWire(dominant_face)) for p in _edge_points(e, OUTLINE_DEFLECTION_MM)]
    if len(pts) < 3:
        return None
    poly = Polygon([(_dot(p, u), _dot(p, v)) for p in pts])
    return poly if poly.is_valid else poly.buffer(0)


def _blank(method: str, area_mm2: float, flat_blank: Dict[str, Any], outline: Any, dominant_face: Any, normal: Vec,
           holes: Optional[List[Dict[str, Any]]]) -> Dict[str, Any]:
    from shapely.geometry import Polygon  # type: ignore

    pierced = [h for h in (holes or []) if h["in_flat"]]
    blank: Dict[str, Any] = {"method": method, "area_mm2": round(area_mm2, 1)}
    shape_m: Dict[str, Any] = {"perimeter_mm": None, "length_mm": None, "width_mm": None, "circumscribed_diameter_mm": None,
                               "outline_points_mm": None}
    if method == "drawn_equal_area":
        if outline is not None and holes is not None:
            shape_m = _drawn_blank(outline, area_mm2, sum(h["area_mm2"] for h in holes))
    elif method == "flat":
        poly = _flat_blank_outline(dominant_face, normal)
        if poly is not None and not poly.is_empty and hasattr(poly, "exterior"):
            shape_m = _outline_measures(poly)
    else:  # true_unfold: the extractor's unfolded outline, when its wire walk resolved one
        pts = (flat_blank.get("outline") or {}).get("outline_points_mm")
        if pts and len(pts) >= 4:
            shape_m = _outline_measures(Polygon(pts))
        elif flat_blank.get("bounding_rect"):
            rect = flat_blank["bounding_rect"]
            shape_m["length_mm"] = round(max(rect["length_mm"], rect["width_mm"]), 2)
            shape_m["width_mm"] = round(min(rect["length_mm"], rect["width_mm"]), 2)
    blank.update(shape_m)
    blank["pierced_hole_area_mm2"] = round(float(sum(h["area_mm2"] for h in pierced)), 1) if holes is not None else None
    blank["pierced_hole_perimeter_mm"] = round(float(sum(h["perimeter_mm"] for h in pierced)), 2) if holes is not None else None
    return blank


# ── the measurement ─────────────────────────────────────────────────────────

def measure_hydroform(
    shape: Any,
    thickness: float,
    dominant_face: Any,
    dominant_normal: Optional[Sequence[float]],
    sheet_faces: Optional[Dict[str, Any]],
    drawn_shell: Optional[Dict[str, Any]],
    bends: Sequence[Dict[str, Any]],
    flat_blank: Optional[Dict[str, Any]],
    bend_count: int,
) -> Optional[Dict[str, Any]]:
    """
    The hydroforming measurements of one sheet part (the module docstring), or None when the part has no sheet frame (no thickness,
    main face or normal).

    sheet_faces   drawn_shell.analyse_sheet_faces(shape, thickness)
    drawn_shell   drawn_shell.detect_drawn_shell's result, or None
    bends         the extractor's deduplicated bends (_collect_dedup_bends, each with its "faces"), drawn ones included: those of the
                  drawn form are left out here by face; [] when the part is flat (its bend candidates are edge noise)
    flat_blank    the extractor's flat pattern of the part ({area_mm2, method, bounding_rect, outline}) when it is one blank, else None
    bend_count    the extractor's bend count (0: no bend was unfolded)
    """
    from OCC.Core.BRepTools import breptools  # type: ignore

    if thickness <= 0 or dominant_face is None or dominant_normal is None or not sheet_faces:
        return None
    normal = _unit(tuple(float(c) for c in dominant_normal))  # type: ignore[arg-type]
    fmap = _face_index_map(shape)
    dom = fmap.FindIndex(dominant_face) - 1
    if dom < 0:
        return None
    emap = _edge_face_map(shape)
    by_index, partners, twinned, adjacency = (sheet_faces["by_index"], sheet_faces["partners"], sheet_faces["twinned"],
                                              sheet_faces["adjacency"])
    main_ids = {dom} | set(partners.get(dom, ()))

    # The part along the press axis.
    sil = projected_outline(shape, normal, SILHOUETTE_DEFLECTION_MM, front_only=_is_solid(shape), edge_deflection=OUTLINE_DEFLECTION_MM)
    geometry = sil["geometry"]
    forming_depth = sil["pull_hi"] - sil["pull_lo"] if geometry is not None else None
    outline = _filled(geometry) if geometry is not None and not geometry.is_empty else None
    plan = {"length_mm": None, "width_mm": None, "min_width_mm": None}
    if outline is not None and not outline.is_empty:
        length, width = _rect_sides(outline)
        hull = outline.convex_hull
        plan = {"length_mm": round(length, 2), "width_mm": round(width, 2),
                "min_width_mm": round(_min_width_2d(list(hull.exterior.coords)), 2) if hasattr(hull, "exterior") else None}

    developed = sum(by_index[i]["area"] for i in twinned) / 2.0
    # The main face's outer boundary (its openings are holes, listed below).
    main_surface = {"area_mm2": round(by_index[dom]["area"], 1), "perimeter_mm": round(_length(breptools.OuterWire(dominant_face)), 2)}

    # The drawn form, and the drawn region's parts that are curved flanges.
    form_ids: Set[int] = set()
    flange_parts: List[Set[int]] = []
    drawn = None
    if drawn_shell:
        region = set(drawn_shell["face_ids"])
        dom_plane = by_index[dom]

        def is_main_plane(j: int) -> bool:
            r = by_index.get(j)
            return bool(r and r["kind"] == "plane" and abs(abs(_dot(r["dir"], normal)) - 1.0) <= _ANG_TOL
                        and abs(_dot((r["point"][0] - dom_plane["point"][0], r["point"][1] - dom_plane["point"][1],
                                      r["point"][2] - dom_plane["point"][2]), normal)) <= _POS_TOL)

        dom_wire_across = [[_across(e, emap, fmap) - {dom} for e in _edges(w)] for w in _wires(dominant_face)]
        form_ids, flange_parts = _split_drawn_region(region, main_ids, dom_wire_across, adjacency, partners, is_main_plane)
        if form_ids:
            if form_ids == region:
                width = drawn_shell["opening_width_mm"]
                form_projected, form_developed = drawn_shell.get("form_projected_area_mm2"), drawn_shell.get("form_developed_area_mm2")
            else:
                m = region_measures(shape, sheet_faces, sorted(form_ids), normal)
                width, form_projected, form_developed = m["opening_width_mm"], m["form_projected_area_mm2"], m["form_developed_area_mm2"]
            drawn = {
                "depth_mm": drawn_shell["depth_mm"],
                "opening_width_mm": _r(width, 2),
                "form_projected_area_mm2": _r(form_projected, 1),
                "form_developed_area_mm2": _r(form_developed, 1),
            }

    flanges: Optional[List[Dict[str, Any]]] = []
    try:
        dist = _face_distances(main_ids, adjacency)
        for b in bends:
            ids = sorted(j for j in (fmap.FindIndex(f) - 1 for f in b.get("faces") or []) if j >= 0)
            if form_ids & set(ids):
                continue
            flanges.append({
                "kind": "straight",
                "angle_deg": round(math.degrees(b["angle_rad"]), 2),
                "length_mm": round(b["axial_length"], 2),
                "height_mm": _r(_straight_leg(b, by_index, twinned, fmap, dist), 2),
                "edge_radius_mm": None,
                "face_ids": ids,
            })
        for part in flange_parts:
            flanges.extend(_curved_flanges(part, by_index, normal, main_ids, adjacency, fmap, emap))
    except Exception as e:
        logger.warning(f"[Hydroform] flanges not measured: {e}")
        flanges = None

    holes: Optional[List[Dict[str, Any]]]
    try:
        holes = _holes(shape, sheet_faces, fmap, emap, dominant_face, dom, main_ids, normal)
    except Exception as e:
        logger.warning(f"[Hydroform] holes not measured: {e}")
        holes = None

    blank = None
    if flat_blank is not None:
        method = None
        area = flat_blank.get("area_mm2") or 0.0
        if drawn_shell:
            method, area = "drawn_equal_area", developed
        elif str(flat_blank.get("method", "")).startswith("true_unfold"):
            method = "true_unfold"
        elif bend_count == 0:
            method = "flat"
        # else: a bent part the extractor could not unfold has no measured blank.
        if method and area > 0:
            blank = _blank(method, area, flat_blank, outline, dominant_face, normal, holes)

    return {
        "version": VERSION,
        "normal": [round(c, 4) + 0.0 for c in normal],  # + 0.0: no "-0.0"
        "forming_depth_mm": _r(forming_depth, 2),
        "plan": plan,
        "projected_area_mm2": _r(geometry.area, 1) if geometry is not None else None,
        "developed_area_mm2": round(developed, 1),
        "main_surface": main_surface,
        "drawn": drawn,
        "blank": blank,
        "flanges": flanges,
        "holes": holes,
    }
