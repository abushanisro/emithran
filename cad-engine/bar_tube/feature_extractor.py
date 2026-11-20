"""
What a bar, tube or profile part's cost rests on, measured from the solid.

A bar and tube part is bought as stock of one cross-section, cut to length, then bent, end formed, holed and notched. So it is measured as a
section swept along a centreline:

  centreline       the straights and bends, in order (bar_tube.centreline): each bend's centreline radius (CLR), angle, the straight before it and
                   the clock angle (how far the tube turns between bends); the developed length (the cut length bought). Bends are torus faces
                   (a round section) or coaxial partial cylinders (any other section). A part with no bends is straight: its axis is the
                   principal axis that makes the most of its surface lie on one swept section (or the engineer's axis).
  section          the cross-section cut normal to the centreline, classified (bar_tube.section): stock form (round, square, rectangular tube or
                   bar, hex bar, angle, channel, tee, I-beam, generic extrusion), size, wall, area, perimeter, circumscribing circle.
  stock surface    a face whose every point lies on the section outline at its place along the centreline: the stock as supplied (bent or
                   not). Every other face is a feature, and adjacent feature faces are one feature:
  ends             a feature at either end of the centreline: a square or angled cut, a notch (cope, fishmouth) or slot, or an end form: flare
                   (a cone opening out), reduction (a smaller coaxial diameter or cone closing in), expansion (a larger diameter), flange (a
                   flat ring standing out), flattening (flats on a round section).
  holes, cutouts   features along the length: a round hole (one coaxial cylinder) or stepped hole, a non-round opening closed in a wall (complex
                   hole), or a cutout open to an edge.
  plate            a flat part that is no section swept along a line (cut from plate or sheet): thickness, cut outline, pierces, blank size.

These are measurements only. Stock, routes (saw or tube laser), bending method, cycle times and cost are decided in the backend from the staged
bar and tube reference data.
"""
from __future__ import annotations

import logging
import math
from typing import Any, Dict, List, Optional, Sequence, Tuple

from bar_tube.centreline import Bend, Centreline, chain_bends, describe_bends, straight_centreline
from bar_tube.section import classify_section, distance_to_outlines
from forging.feature_extractor import solid_volume
from injection_molding.recognition.mesh import FaceMesh, tessellate_faces
from injection_molding.recognition.vec import Vec, cross, dot, norm, scale, sub, unit
from shared.casting_geometry import _faces
from shared.stable_face_id import build_stable_face_id_map

logger = logging.getLogger(__name__)

VERSION = "bar-tube-1"
TWO_PI = 2.0 * math.pi
# A stock part has nearly all its surface on the swept section: holes, cutouts and end caps take little (a formed end, 5 to 12 %; the caps of a
# piece as short as its section is wide, about 13 %). A stepped turned shaft, a machined part, has a third of its surface off any one section:
# below this share the part is not bar or tube stock.
STOCK_FRACTION = 0.8
# Coaxial partial cylinders are a bend (not the corner radii of a straight) when their length along the axis is within this many times their
# largest radius: a bend is as long as the section is wide, a corner radius runs the length of the straight.
BEND_AXIAL_RATIO = 2.5
SAMPLES_PER_FACE = 8
# The section outline is sampled to this chord error (mm): a 1.5 mm tube wall is read to well under 1 %.
SECTION_DEFLECTION = 0.002


# ---------------------------------------------------------------------------------------------------------------------------------------
# Faces
# ---------------------------------------------------------------------------------------------------------------------------------------

def _vec(p: Any) -> Vec:
    return (float(p.X()), float(p.Y()), float(p.Z()))


def _canonical_sign(axis: Vec) -> float:
    for c in axis:
        if abs(c) > 1e-9:
            return 1.0 if c > 0 else -1.0
    return 1.0


def surface_info(faces: Sequence[Any]) -> List[Dict[str, Any]]:
    """Each face's analytic surface: type and parameters (plane normal; cylinder, cone and torus axis, radii and angle range)."""
    from OCC.Core.BRepAdaptor import BRepAdaptor_Surface  # type: ignore
    from OCC.Core.BRepTools import breptools  # type: ignore
    from OCC.Core.GeomAbs import GeomAbs_Cone, GeomAbs_Cylinder, GeomAbs_Plane, GeomAbs_Torus  # type: ignore
    from OCC.Core.TopAbs import TopAbs_REVERSED  # type: ignore

    out: List[Dict[str, Any]] = []
    for i, f in enumerate(faces):
        info: Dict[str, Any] = {"index": i, "type": "other"}
        try:
            a = BRepAdaptor_Surface(f)
            st = a.GetType()
            u1, u2, v1, v2 = breptools.UVBounds(f)
            if st == GeomAbs_Plane:
                pl = a.Plane()
                n = _vec(pl.Axis().Direction())
                if f.Orientation() == TopAbs_REVERSED:
                    n = scale(n, -1.0)
                info.update(type="plane", normal=n, origin=_vec(pl.Location()))
            elif st == GeomAbs_Cylinder:
                c = a.Cylinder()
                pos = c.Position()
                info.update(type="cylinder", origin=_vec(pos.Location()), axis=_vec(pos.Direction()), x=_vec(pos.XDirection()),
                            radius=float(c.Radius()), u=(u1, u2), v=(v1, v2))
            elif st == GeomAbs_Cone:
                c = a.Cone()
                pos = c.Position()
                info.update(type="cone", origin=_vec(pos.Location()), axis=_vec(pos.Direction()), radius=float(c.RefRadius()),
                            half_angle=float(c.SemiAngle()), u=(u1, u2), v=(v1, v2))
            elif st == GeomAbs_Torus:
                t = a.Torus()
                pos = t.Position()
                info.update(type="torus", origin=_vec(pos.Location()), axis=_vec(pos.Direction()), x=_vec(pos.XDirection()),
                            major=float(t.MajorRadius()), minor=float(t.MinorRadius()), u=(u1, u2), v=(v1, v2))
        except Exception as e:  # an unreadable surface is "other"; it can still be a feature
            logger.debug(f"[BarTube] surface {i}: {e}")
        out.append(info)
    return out


def _angle_in(x0: Vec, y0: Vec, d: Vec) -> float:
    return math.atan2(dot(d, y0), dot(d, x0))


def _union_arc(intervals: Sequence[Tuple[float, float]]) -> Optional[Tuple[float, float]]:
    """The union of angle intervals (radians) as one interval [t0, t1] with t1 - t0 <= 2 pi, or None when they do not join into one."""
    if not intervals:
        return None
    norm_iv = []
    for a, b in intervals:
        w = b - a
        if w >= TWO_PI - 1e-6:
            return (0.0, TWO_PI)
        a = a % TWO_PI
        norm_iv.append((a, a + w))
    norm_iv.sort()
    # Try each interval as the start; join the rest going round.
    for k in range(len(norm_iv)):
        start, end = norm_iv[k]
        changed = True
        used = {k}
        while changed:
            changed = False
            for j, (a, b) in enumerate(norm_iv):
                if j in used:
                    continue
                for shift in (0.0, TWO_PI, -TWO_PI):
                    if a + shift <= end + 1e-4 and b + shift >= start - 1e-4:
                        start, end = min(start, a + shift), max(end, b + shift)
                        used.add(j)
                        changed = True
                        break
        if len(used) == len(norm_iv):
            if end - start >= TWO_PI - 1e-4:
                return (0.0, TWO_PI)
            return (start, end)
    return None


def _same_line(o1: Vec, a1: Vec, o2: Vec, a2: Vec, tol: float) -> bool:
    if abs(abs(dot(a1, a2)) - 1.0) > 1e-4:
        return False
    rel = sub(o2, o1)
    return norm(sub(rel, scale(a1, dot(rel, a1)))) <= tol


def _axial_range(mesh: FaceMesh, origin: Vec, axis: Vec) -> Tuple[float, float]:
    vals = [dot(sub(v, origin), axis) for t in mesh.triangles for v in t.vertices]
    return (min(vals), max(vals)) if vals else (0.0, 0.0)


def find_bends(info: Sequence[Dict[str, Any]], meshes: Dict[int, FaceMesh], tol: float) -> List[Bend]:
    """The bends of the part: torus faces round one centre and axis with one major radius (a round section), and coaxial partial cylinders of
    two or more radii as long as the section is wide (any other section)."""
    bends: List[Bend] = []

    # Torus bends.
    groups: List[List[Dict[str, Any]]] = []
    for f in info:
        if f["type"] != "torus" or f["major"] <= f["minor"]:
            continue
        for g in groups:
            h = g[0]
            if norm(sub(f["origin"], h["origin"])) <= tol and abs(abs(dot(f["axis"], h["axis"])) - 1) < 1e-4 and abs(f["major"] - h["major"]) <= tol:
                g.append(f)
                break
        else:
            groups.append([f])
    for g in groups:
        bend = _arc_from_group(g, "torus", tol)
        if bend is not None:
            bend.radius = g[0]["major"]
            bend.section_radius = max(f["minor"] for f in g)
            bends.append(bend)

    # Coaxial partial cylinders: first each radius's faces round one axis line (a full circle split in faces is not partial).
    lines: List[List[Dict[str, Any]]] = []
    for f in info:
        if f["type"] != "cylinder":
            continue
        for g in lines:
            h = g[0]
            if _same_line(h["origin"], h["axis"], f["origin"], f["axis"], tol):
                g.append(f)
                break
        else:
            lines.append([f])
    for g in lines:
        radii: Dict[float, List[Dict[str, Any]]] = {}
        for f in g:
            key = next((r for r in radii if abs(r - f["radius"]) <= tol), f["radius"])
            radii.setdefault(key, []).append(f)
        if len(radii) < 2:
            continue
        arcs = {r: _arc_from_group(fs, "cylinder", tol) for r, fs in radii.items()}
        if any(a is None or a.closed() for a in arcs.values()):
            continue
        sweeps = [a.sweep for a in arcs.values()]  # type: ignore[union-attr]
        if max(sweeps) - min(sweeps) > math.radians(1.0):
            continue
        first = next(iter(arcs.values()))
        assert first is not None
        axis, origin = first.axis, g[0]["origin"]
        lo, hi = math.inf, -math.inf
        for f in g:
            m = meshes.get(f["index"])
            if m is not None:
                a, b = _axial_range(m, origin, axis)
                lo, hi = min(lo, a), max(hi, b)
        rmin, rmax = min(radii), max(radii)
        if not math.isfinite(lo) or (hi - lo) > BEND_AXIAL_RATIO * rmax:
            continue
        mid = (lo + hi) / 2.0
        first.centre = (origin[0] + axis[0] * mid, origin[1] + axis[1] * mid, origin[2] + axis[2] * mid)
        first.radius = (rmin + rmax) / 2.0
        first.section_radius = math.hypot((rmax - rmin) / 2.0, (hi - lo) / 2.0)
        first.face_ids = sorted(f["index"] for f in g)
        first.source = "cylinder"
        bends.append(first)
    return bends


def _arc_from_group(group: Sequence[Dict[str, Any]], source: str, tol: float) -> Optional[Bend]:
    """One arc from faces sharing an axis: their u ranges (angles about the axis) joined in the first face's frame."""
    h = group[0]
    sign = _canonical_sign(h["axis"])
    axis = scale(h["axis"], sign)
    x0 = h["x"]
    y0 = cross(axis, x0)
    intervals: List[Tuple[float, float]] = []
    for f in group:
        fx = f["x"]
        s = 1.0 if dot(f["axis"], axis) > 0 else -1.0
        u1, u2 = f["u"]
        # The face's angles are about its own axis from its own x: about our axis they run the other way when its axis is reversed.
        off = _angle_in(x0, y0, fx)
        a, b = (off + u1, off + u2) if s > 0 else (off - u2, off - u1)
        intervals.append((a, b))
    arc = _union_arc(intervals)
    if arc is None:
        return None
    return Bend(centre=h["origin"], axis=axis, x=x0, radius=0.0, t0=arc[0], t1=arc[1], face_ids=sorted(f["index"] for f in group), source=source)


# ---------------------------------------------------------------------------------------------------------------------------------------
# Section
# ---------------------------------------------------------------------------------------------------------------------------------------

def _wire_points(wire: Any, face: Any, deflection: float) -> List[Vec]:
    from OCC.Core.BRepAdaptor import BRepAdaptor_Curve  # type: ignore
    from OCC.Core.BRepTools import BRepTools_WireExplorer  # type: ignore
    from OCC.Core.GCPnts import GCPnts_QuasiUniformDeflection  # type: ignore
    from OCC.Core.TopAbs import TopAbs_REVERSED  # type: ignore

    pts: List[Vec] = []
    ex = BRepTools_WireExplorer(wire, face)
    while ex.More():
        edge = ex.Current()
        curve = BRepAdaptor_Curve(edge)
        disc = GCPnts_QuasiUniformDeflection(curve, deflection)
        seg = [_vec(disc.Value(i)) for i in range(1, disc.NbPoints() + 1)] if disc.IsDone() else [_vec(curve.Value(curve.FirstParameter())), _vec(curve.Value(curve.LastParameter()))]
        if edge.Orientation() == TopAbs_REVERSED:
            seg.reverse()
        for p in seg:
            if not pts or norm(sub(p, pts[-1])) > 1e-6:
                pts.append(p)
        ex.Next()
    if len(pts) > 1 and norm(sub(pts[0], pts[-1])) <= 1e-6:
        pts.pop()
    return pts


def cut_section(shape: Any, centre: Vec, u: Vec, v: Vec, t: Vec, reach: float, deflection: float) -> Optional[Dict[str, Any]]:
    """The cross-section at `centre` normal to t, as 2D outlines in the (u, v) frame: the face of the cut nearest the centreline point."""
    from OCC.Core.BRepAlgoAPI import BRepAlgoAPI_Common  # type: ignore
    from OCC.Core.BRepBuilderAPI import BRepBuilderAPI_MakeFace, BRepBuilderAPI_MakeVertex  # type: ignore
    from OCC.Core.BRepExtrema import BRepExtrema_DistShapeShape  # type: ignore
    from OCC.Core.BRepTools import breptools  # type: ignore
    from OCC.Core.TopAbs import TopAbs_FACE, TopAbs_WIRE  # type: ignore
    from OCC.Core.TopExp import TopExp_Explorer  # type: ignore
    from OCC.Core.TopoDS import topods  # type: ignore
    from OCC.Core.gp import gp_Ax3, gp_Dir, gp_Pln, gp_Pnt  # type: ignore

    plane = gp_Pln(gp_Ax3(gp_Pnt(*centre), gp_Dir(*t), gp_Dir(*u)))
    cutter = BRepBuilderAPI_MakeFace(plane, -reach, reach, -reach, reach).Face()
    common = BRepAlgoAPI_Common(shape, cutter)
    if not common.IsDone():
        return None
    vertex = BRepBuilderAPI_MakeVertex(gp_Pnt(*centre)).Vertex()
    best, best_d = None, math.inf
    ex = TopExp_Explorer(common.Shape(), TopAbs_FACE)
    while ex.More():
        face = topods.Face(ex.Current())
        d = BRepExtrema_DistShapeShape(vertex, face)
        dist = d.Value() if d.IsDone() else math.inf
        if dist < best_d:
            best, best_d = face, dist
        ex.Next()
    if best is None:
        return None
    outer = breptools.OuterWire(best)

    def to2d(pts: Sequence[Vec]) -> List[Tuple[float, float]]:
        return [(dot(sub(p, centre), u), dot(sub(p, centre), v)) for p in pts]
    inners: List[List[Tuple[float, float]]] = []
    wx = TopExp_Explorer(best, TopAbs_WIRE)
    outer2d: List[Tuple[float, float]] = []
    while wx.More():
        w = topods.Wire(wx.Current())
        pts = to2d(_wire_points(w, best, deflection))
        if w.IsSame(outer):
            outer2d = pts
        elif len(pts) >= 3:
            inners.append(pts)
        wx.Next()
    if len(outer2d) < 3:
        return None
    return {"outer": outer2d, "inners": inners}


# ---------------------------------------------------------------------------------------------------------------------------------------
# Stock surface and features
# ---------------------------------------------------------------------------------------------------------------------------------------

def surface_samples(face: Any, n: int = SAMPLES_PER_FACE) -> List[Vec]:
    """Points exactly on the face (not on a mesh chord): a grid over its parameter range, kept where it falls inside the face's outline."""
    from OCC.Core.BRepAdaptor import BRepAdaptor_Surface  # type: ignore
    from OCC.Core.BRepTools import breptools  # type: ignore
    from OCC.Core.BRepTopAdaptor import BRepTopAdaptor_FClass2d  # type: ignore
    from OCC.Core.TopAbs import TopAbs_IN  # type: ignore
    from OCC.Core.gp import gp_Pnt2d  # type: ignore

    u1, u2, v1, v2 = breptools.UVBounds(face)
    surf = BRepAdaptor_Surface(face)
    cls = BRepTopAdaptor_FClass2d(face, 1e-7)
    out: List[Vec] = []
    for k in (5, 9, 17):
        for i in range(1, k):
            for j in range(1, k):
                u = u1 + (u2 - u1) * i / k
                v = v1 + (v2 - v1) * j / k
                if cls.Perform(gp_Pnt2d(u, v)) == TopAbs_IN:
                    out.append(_vec(surf.Value(u, v)))
        if len(out) >= n:
            break
    if len(out) > n:
        step = len(out) / n
        out = [out[int(i * step)] for i in range(n)]
    return out


def _vertices(mesh: FaceMesh, n: int = 0) -> List[Vec]:
    """The face's distinct mesh nodes (every one: a stride over the mesh's own order can land all on one boundary loop and miss its length).
    With n, at most n of them, spread over the face by sorting before striding."""
    vs = sorted({(round(v[0], 6), round(v[1], 6), round(v[2], 6)) for t in mesh.triangles for v in t.vertices})
    if n and len(vs) > n:
        step = len(vs) / n
        vs = [vs[int(i * step)] for i in range(n)] + [vs[-1]]
    return vs


def classify_faces(cl: Centreline, outlines: Sequence[Sequence[Tuple[float, float]]], meshes: Sequence[FaceMesh], faces: Sequence[Any],
                   on_tol: float) -> Dict[int, Dict[str, Any]]:
    """Per face: on the stock surface or not, and its station range along the developed length."""
    out: Dict[int, Dict[str, Any]] = {}
    for m in meshes:
        on = True
        try:
            samples = surface_samples(faces[m.index])
        except Exception:
            samples = [t.centroid for t in m.triangles[:SAMPLES_PER_FACE]]
        # The mesh's nodes lie on the face too, and reach its outline: a flat face wider than the section somewhere is caught at its corners.
        samples = samples + _vertices(m, 30)
        for p in samples:
            xy, loc = cl.to_section(p)
            if loc.beyond > on_tol or distance_to_outlines(xy, outlines) > on_tol:
                on = False
                break
        stations = [cl.locate(p) for p in _vertices(m, 200)]
        lo = min((s.station - s.beyond for s in stations), default=0.0)
        hi = max((s.station + s.beyond for s in stations), default=0.0)
        out[m.index] = {"stock": on and bool(samples), "station": (lo, hi)}
    return out


def _adjacency(shape: Any, faces: Sequence[Any]) -> Dict[int, set]:
    from OCC.Core.TopAbs import TopAbs_EDGE, TopAbs_FACE  # type: ignore
    from OCC.Core.TopExp import topexp  # type: ignore
    from OCC.Core.TopTools import TopTools_IndexedDataMapOfShapeListOfShape  # type: ignore

    index = _face_index(faces)
    emap = TopTools_IndexedDataMapOfShapeListOfShape()
    topexp.MapShapesAndAncestors(shape, TopAbs_EDGE, TopAbs_FACE, emap)
    adj: Dict[int, set] = {i: set() for i in range(len(faces))}
    for k in range(1, emap.Size() + 1):
        ids = [index(f) for f in _shapes(emap.FindFromIndex(k))]
        ids = [i for i in ids if i is not None]
        for a in ids:
            for b in ids:
                if a != b:
                    adj[a].add(b)
    return adj


def _shapes(shape_list: Any) -> List[Any]:
    """A TopTools_ListOfShape as a Python list."""
    from OCC.Core.TopTools import TopTools_ListIteratorOfListOfShape  # type: ignore
    out = []
    it = TopTools_ListIteratorOfListOfShape(shape_list)
    while it.More():
        out.append(it.Value())
        it.Next()
    return out


def _face_index(faces: Sequence[Any]):
    buckets: Dict[int, List[Tuple[int, Any]]] = {}
    for i, f in enumerate(faces):
        buckets.setdefault(hash(f), []).append((i, f))

    def find(f: Any) -> Optional[int]:
        for i, g in buckets.get(hash(f), []):
            if g.IsSame(f):
                return i
        for i, g in enumerate(faces):  # a hash that differs by orientation
            if g.IsSame(f):
                return i
        return None
    return find


def _groups(ids: Sequence[int], adj: Dict[int, set]) -> List[List[int]]:
    left = set(ids)
    out: List[List[int]] = []
    while left:
        seed = left.pop()
        group, stack = [seed], [seed]
        while stack:
            for n in adj.get(stack.pop(), ()):
                if n in left:
                    left.remove(n)
                    group.append(n)
                    stack.append(n)
        out.append(sorted(group))
    return sorted(out)


def _edge_length_between(shape: Any, faces: Sequence[Any], group: Sequence[int], others: Sequence[int]) -> float:
    """The length of the edges the group's faces share with `others` (its outline on the stock)."""
    from OCC.Core.BRepGProp import brepgprop  # type: ignore
    from OCC.Core.GProp import GProp_GProps  # type: ignore
    from OCC.Core.TopAbs import TopAbs_EDGE, TopAbs_FACE  # type: ignore
    from OCC.Core.TopExp import topexp  # type: ignore
    from OCC.Core.TopTools import TopTools_IndexedDataMapOfShapeListOfShape  # type: ignore

    index = _face_index(faces)
    emap = TopTools_IndexedDataMapOfShapeListOfShape()
    topexp.MapShapesAndAncestors(shape, TopAbs_EDGE, TopAbs_FACE, emap)
    g, o = set(group), set(others)
    total = 0.0
    for k in range(1, emap.Size() + 1):
        ids = {index(f) for f in _shapes(emap.FindFromIndex(k))}
        if ids & g and ids & o:
            props = GProp_GProps()
            brepgprop.LinearProperties(emap.FindKey(k), props)
            total += float(props.Mass())
    return total


def _inner_wire_edges_touch(shape: Any, faces: Sequence[Any], stock: Sequence[int], group: Sequence[int]) -> bool:
    """Whether the group meets a stock face along one of that face's inner outlines (an opening closed within the wall)."""
    from OCC.Core.BRepTools import breptools  # type: ignore
    from OCC.Core.TopAbs import TopAbs_EDGE, TopAbs_FACE, TopAbs_WIRE  # type: ignore
    from OCC.Core.TopExp import TopExp_Explorer, topexp  # type: ignore
    from OCC.Core.TopTools import TopTools_IndexedDataMapOfShapeListOfShape  # type: ignore
    from OCC.Core.TopoDS import topods  # type: ignore

    index = _face_index(faces)
    g = set(group)
    emap = TopTools_IndexedDataMapOfShapeListOfShape()
    topexp.MapShapesAndAncestors(shape, TopAbs_EDGE, TopAbs_FACE, emap)
    for si in stock:
        face = topods.Face(faces[si])
        outer = breptools.OuterWire(face)
        wx = TopExp_Explorer(face, TopAbs_WIRE)
        while wx.More():
            w = topods.Wire(wx.Current())
            if not w.IsSame(outer):
                ex = TopExp_Explorer(w, TopAbs_EDGE)
                while ex.More():
                    k = emap.FindIndex(ex.Current())
                    if k and any(index(f) in g for f in _shapes(emap.FindFromIndex(k))):
                        return True
                    ex.Next()
            wx.Next()
    return False


def _hole(group: Sequence[int], info: Sequence[Dict[str, Any]], meshes: Dict[int, FaceMesh], tol: float) -> Optional[Dict[str, Any]]:
    """A round hole: cylinders round one axis line (one radius: a simple hole; several, with flat steps between: a stepped hole)."""
    cyl = [info[i] for i in group if info[i]["type"] == "cylinder"]
    rest = [info[i] for i in group if info[i]["type"] != "cylinder"]
    if not cyl:
        return None
    h = cyl[0]
    if not all(_same_line(h["origin"], h["axis"], f["origin"], f["axis"], tol) for f in cyl):
        return None
    axis = unit(h["axis"])
    if any(f["type"] != "plane" or abs(abs(dot(f["normal"], axis)) - 1) > 1e-3 for f in rest):
        return None
    radii: Dict[float, List[Dict[str, Any]]] = {}
    for f in cyl:
        key = next((r for r in radii if abs(r - f["radius"]) <= tol), f["radius"])
        radii.setdefault(key, []).append(f)
    for fs in radii.values():
        arc = _union_arc([(f["u"][0], f["u"][1]) for f in fs]) if len(fs) == 1 else _arc_from_group(fs, "cylinder", tol)
        if arc is None:
            return None
        sweep = arc[1] - arc[0] if isinstance(arc, tuple) else arc.sweep
        if sweep < TWO_PI - 1e-3:
            return None
    lo, hi = math.inf, -math.inf
    steps = []
    for r, fs in sorted(radii.items(), reverse=True):
        a0, a1 = math.inf, -math.inf
        for f in fs:
            m = meshes.get(f["index"])
            if m is not None:
                a, b = _axial_range(m, h["origin"], axis)
                a0, a1 = min(a0, a), max(a1, b)
        lo, hi = min(lo, a0), max(hi, a1)
        steps.append({"diameter_mm": round(2 * r, 3), "depth_mm": round(a1 - a0, 3)})
    return {
        "feature_type": "SimpleHole" if len(radii) == 1 else "MultiStepHole",
        "diameter_mm": round(2 * max(radii), 3),
        "depth_mm": round(hi - lo, 3),
        "axis": [round(c, 5) for c in axis],
        "steps": steps if len(radii) > 1 else None,
    }


def _end_kind(group: Sequence[int], info: Sequence[Dict[str, Any]], t: Vec, section: Dict[str, Any], tol: float,
              reach: Optional[Dict[int, float]] = None, span: Optional[Dict[int, float]] = None) -> Tuple[str, str, Optional[float]]:
    """(feature type, variant, cut angle) of the faces at one end. `reach`: each face's farthest point from the centreline; `span`: its length
    along the centreline."""
    reach = reach or {}
    span = span or {}
    faces = [info[i] for i in group]
    types = [f["type"] for f in faces]
    round_section = section.get("stock_form") in ("ROUND_TUBE", "ROUND_BAR")
    outer_r = (section.get("od_mm") or section.get("width_mm") or 0.0) / 2.0
    if len(faces) == 1 and types[0] == "plane":
        c = abs(dot(faces[0]["normal"], t))
        if c > 1 - 1e-4:
            return "End", "square", 0.0
        return "End", "angled", round(math.degrees(math.acos(min(1.0, c))), 2)
    coaxial = lambda f: abs(abs(dot(unit(f["axis"]), t)) - 1) < 1e-3  # noqa: E731
    cyls = [f for f in faces if f["type"] == "cylinder" and coaxial(f)]
    cones = [f for f in faces if f["type"] == "cone" and coaxial(f)]
    if cyls and round_section:
        # A formed length of another diameter (reached through a short cone): larger is an expansion, smaller a reduction. A larger diameter
        # that stands out farther than it is long is the rim of a flange.
        big = max(cyls, key=lambda f: f["radius"])
        r = big["radius"]
        if r > outer_r + tol:
            if (r - outer_r) > span.get(big["index"], math.inf) and any(
                    f["type"] == "plane" and abs(abs(dot(f["normal"], t)) - 1) < 1e-4 and reach.get(f["index"], 0.0) > outer_r + tol for f in faces):
                return "Form", "flange", None
            return "Form", "expansion", None
        if not any(abs(f["radius"] - outer_r) <= tol for f in cyls):
            return "Form", "reduction", None
    if cones and round_section:
        # A cone that opens toward the end (t points out of the part) is a flare; one that closes is a reduction (taper).
        c = cones[0]
        opens = (dot(unit(c["axis"]), t) > 0) == (c["half_angle"] > 0)
        return "Form", "flare" if opens else "reduction", None
    planes = [f for f in faces if f["type"] == "plane"]
    flats = [f for f in planes if abs(dot(f["normal"], t)) < 1e-3]
    if round_section and any(dot(a["normal"], b["normal"]) < -1 + 1e-3 for a in flats for b in flats):
        # Flattened: the round squeezed between two flats facing opposite ways (one flat alone is a notch cut into the side).
        return "Form", "flattening", None
    if round_section and any(abs(abs(dot(f["normal"], t)) - 1) < 1e-4 and reach.get(f["index"], 0.0) > outer_r + tol for f in planes):
        # A flat ring standing out past the tube's outside: a flange.
        return "Form", "flange", None
    slot_walls = [f for f in planes if abs(dot(f["normal"], t)) < 1e-3]
    if len(slot_walls) >= 2 and any(f["type"] == "cylinder" and abs(dot(unit(f["axis"]), t)) < 1e-3 for f in faces):
        return "End", "slot", None
    return "End", "notch", None


def plate_measurements(shape: Any, faces: Sequence[Any], info: Sequence[Dict[str, Any]], meshes: Sequence[FaceMesh], deflection: float) -> Optional[Dict[str, Any]]:
    """A flat part cut from plate: two largest parallel planar faces, the thickness between them, the cut outline, pierces and blank size."""
    from OCC.Core.BRepGProp import brepgprop  # type: ignore
    from OCC.Core.BRepTools import breptools  # type: ignore
    from OCC.Core.GProp import GProp_GProps  # type: ignore
    from OCC.Core.TopAbs import TopAbs_WIRE  # type: ignore
    from OCC.Core.TopExp import TopExp_Explorer  # type: ignore
    from OCC.Core.TopoDS import topods  # type: ignore

    from bar_tube.section import min_area_rect

    area = {m.index: m.area for m in meshes}
    planes = sorted((f for f in info if f["type"] == "plane"), key=lambda f: -area.get(f["index"], 0.0))
    if len(planes) < 2:
        return None
    top = planes[0]
    opposite = next((f for f in planes[1:] if dot(f["normal"], top["normal"]) < -1 + 1e-4 and abs(area.get(f["index"], 0) - area[top["index"]]) <= 0.02 * area[top["index"]]), None)
    if opposite is None:
        return None
    thickness = abs(dot(sub(opposite["origin"], top["origin"]), top["normal"]))
    total = sum(area.values())
    if (area[top["index"]] + area[opposite["index"]]) < 0.6 * total:
        return None
    face = topods.Face(faces[top["index"]])
    outer = breptools.OuterWire(face)
    cut = 0.0
    pierces = 0
    pts: List[Vec] = []
    wx = TopExp_Explorer(face, TopAbs_WIRE)
    while wx.More():
        w = topods.Wire(wx.Current())
        props = GProp_GProps()
        brepgprop.LinearProperties(w, props)
        cut += float(props.Mass())
        if w.IsSame(outer):
            pts = _wire_points(w, face, deflection)
        else:
            pierces += 1
        wx.Next()
    n = unit(top["normal"])
    a = (1.0, 0.0, 0.0) if abs(n[0]) < 0.9 else (0.0, 1.0, 0.0)
    u = unit(sub(a, scale(n, dot(a, n))))
    v = cross(n, u)
    length, width, _ = min_area_rect([(dot(p, u), dot(p, v)) for p in pts])
    return {
        "thickness_mm": round(thickness, 3),
        "cut_length_mm": round(cut, 3),
        "pierce_count": pierces,
        "blank_length_mm": round(length, 3),
        "blank_width_mm": round(width, 3),
        "face_area_mm2": round(area[top["index"]], 3),
        "face_ids": [top["index"], opposite["index"]],
    }


# ---------------------------------------------------------------------------------------------------------------------------------------
# The extractor
# ---------------------------------------------------------------------------------------------------------------------------------------

def _principal_axes(shape: Any) -> Tuple[Optional[Vec], List[Vec]]:
    from OCC.Core.BRepGProp import brepgprop  # type: ignore
    from OCC.Core.GProp import GProp_GProps  # type: ignore
    props = GProp_GProps()
    brepgprop.VolumeProperties(shape, props)
    pp = props.PrincipalProperties()
    moments = pp.Moments()
    axes = [_vec(pp.FirstAxisOfInertia()), _vec(pp.SecondAxisOfInertia()), _vec(pp.ThirdAxisOfInertia())]
    order = sorted(range(3), key=lambda i: moments[i])  # least moment first: the long axis
    return _vec(props.CentreOfMass()), [unit(axes[i]) for i in order]


class BarTubeFeatureExtractor:
    def extract(
        self,
        shape: Any,
        bbox_dims: Sequence[float],
        face_map: Optional[List[Any]] = None,
        face_map_tri_total: int = 0,
        axis_override: Optional[Tuple[float, float, float]] = None,
    ) -> Dict[str, Any]:
        diagonal = math.sqrt(sum(float(x) ** 2 for x in bbox_dims)) or 1.0
        deflection = max(0.02, diagonal * 0.0005)
        tol = 0.05  # the model's own geometric tolerance (mm): faces are compared exactly, not through the mesh
        meshes = tessellate_faces(shape, linear_deflection=deflection)
        by_index = {m.index: m for m in meshes}
        faces = _faces(shape)
        info = surface_info(faces)
        vertices = [v for m in meshes for t in m.triangles for v in t.vertices]
        volume = solid_volume(shape)
        surface_area = sum(m.area for m in meshes)

        stable: Dict[int, str] = {}
        try:
            stable = build_stable_face_id_map(shape)
        except Exception as e:  # the ids only serve highlighting
            logger.warning(f"[BarTube] stable_face_id build failed: {e}")

        bends = find_bends(info, by_index, tol)
        candidates: List[Tuple[Centreline, str]] = []
        if bends:
            cl = chain_bends(bends, vertices, tol)
            if cl is not None:
                candidates.append((cl, "bends"))
        if not candidates:
            centre, axes = _principal_axes(shape)
            dirs: List[Tuple[Vec, str]] = []
            if axis_override is not None:
                dirs.append((unit(axis_override), "engineer"))
            else:
                full = [f for f in info if f["type"] == "cylinder"]
                if full:
                    biggest = max(full, key=lambda f: f["radius"])
                    dirs.append((unit(biggest["axis"]), "cylinder"))
                dirs += [(a, "principal") for a in axes]
            for d, why in dirs:
                d = scale(d, _canonical_sign(d))  # one way along the axis, so "start" is the same end every time
                origin = centre
                if why == "cylinder":
                    big = max((f for f in info if f["type"] == "cylinder"), key=lambda f: f["radius"])
                    rel = sub(centre, big["origin"])
                    origin = sub(centre, sub(rel, scale(d, dot(rel, d))))
                vals = [dot(sub(p, origin), d) for p in vertices]
                lo, hi = min(vals), max(vals)
                start = (origin[0] + d[0] * lo, origin[1] + d[1] * lo, origin[2] + d[2] * lo)
                candidates.append((straight_centreline(start, d, hi - lo), why))

        best: Optional[Dict[str, Any]] = None
        for cl, why in candidates:
            result = self._measure(shape, faces, info, meshes, cl, deflection, tol, diagonal)
            if result is None:
                continue
            result["axis_source"] = why
            sec = result["section"]
            if why != "bends" and result["developed_length_mm"] < 0.5 * max(sec["width_mm"], sec["height_mm"]) and sec["stock_form"] in ("GENERIC_EXTRUSION", "RECTANGULAR_BAR"):
                # Thinner along this axis than half its section: a slab cut from plate, not a length of stock.
                continue
            if best is None or result["stock_fraction"] > best["stock_fraction"] + 0.02 or (
                    abs(result["stock_fraction"] - best["stock_fraction"]) <= 0.02 and result["developed_length_mm"] > best["developed_length_mm"]):
                best = result

        plate = None
        if best is None or best["stock_fraction"] < STOCK_FRACTION:
            if not bends:
                plate = plate_measurements(shape, faces, info, meshes, deflection)

        out: Dict[str, Any] = {
            "extraction_version": VERSION,
            "part_volume_mm3": round(volume, 3) if volume is not None else None,
            "surface_area_mm2": round(surface_area, 3),
        }
        all_faces = sorted(m.index for m in meshes)
        if plate is not None:
            out.update(stock_form="PLATE", plate=plate, section=None, bends=[], bend_count=0, holes=[], ends=[], forms=[], cutouts=[],
                       complex_holes=[], developed_length_mm=None, stock_fraction=best["stock_fraction"] if best else 0.0)
            features = _stock_face_features(info, plate["face_ids"], stable)
            measurements = {
                "plate_thickness": _m(plate["thickness_mm"], "mm", "distance between the two largest parallel flat faces", plate["face_ids"]),
                "cut_length": _m(plate["cut_length_mm"], "mm", "the outline of the flat face, outside and every opening", [plate["face_ids"][0]]),
                "surface_area": _m(round(surface_area, 3), "mm2", "every face of the part", all_faces),
            }
        elif best is not None and best["stock_fraction"] >= STOCK_FRACTION:
            features = best.pop("features")
            measurements = best.pop("measurements")
            measurements["surface_area"] = _m(round(surface_area, 3), "mm2", "every face of the part", all_faces)
            out.update(best)
        else:
            out.update(stock_form=None, reason="not one cross-section along a straight or bent line, and not a flat plate",
                       stock_fraction=best["stock_fraction"] if best else 0.0, section=None, bends=[], bend_count=0, holes=[], ends=[], forms=[],
                       cutouts=[], complex_holes=[], developed_length_mm=None)
            features, measurements = [], {"surface_area": _m(round(surface_area, 3), "mm2", "every face of the part", all_faces)}
        if volume is not None:
            measurements["part_volume"] = _m(round(volume, 3), "mm3", "the solid's volume", all_faces)
        _add_stable(features, stable)
        out["feature_graph_v2"] = {
            "metadata": {"face_map": face_map or [], "stl_tri_total": face_map_tri_total or None, "stable_face_ids": stable},
            "features": features,
            "conditions": [],
            "measurements": measurements,
        }
        logger.info(
            f"[BarTube] form={out.get('stock_form')} length={out.get('developed_length_mm')} bends={out.get('bend_count')} "
            f"holes={len(out.get('holes') or [])} ends={[e.get('variant') for e in out.get('ends') or []]} stock_fraction={out.get('stock_fraction')}"
        )
        return out

    def _measure(self, shape: Any, faces: Sequence[Any], info: Sequence[Dict[str, Any]], meshes: Sequence[FaceMesh], cl: Centreline,
                 deflection: float, tol: float, diagonal: float) -> Optional[Dict[str, Any]]:
        # The section: cut across the longest straight (at three places, keeping the largest: a cut through a hole is smaller), else the first bend.
        straights = [s for s in cl.segments if s.kind == "straight" and s.length > 4 * tol]
        bend_segs = cl.bends()
        section_radius = max((s.bend.section_radius for s in bend_segs if s.bend), default=0.0)
        reach = (3.0 * section_radius + 10 * tol) if bend_segs else diagonal
        stations: List[Tuple[Any, float]] = []
        if straights:
            seg = max(straights, key=lambda s: s.length)
            stations = [(seg, seg.length * f) for f in (0.5, 0.31, 0.69)]
        elif bend_segs:
            seg = bend_segs[0]
            stations = [(seg, seg.length * 0.5)]
        best_cut = None
        for seg, s in stations:
            u, v, t = seg.frame(s)
            cut = cut_section(shape, seg.point(s), u, v, t, reach, SECTION_DEFLECTION)
            if cut is None:
                continue
            sec = classify_section(cut["outer"], cut["inners"])
            if best_cut is None or sec["area_mm2"] > best_cut[1]["area_mm2"] + 1e-6:
                best_cut = (cut, sec)
        if best_cut is None:
            return None
        cut, section = best_cut
        size = max(section["width_mm"], section["height_mm"], 1.0)
        thin = min(x for x in (section["height_mm"], section.get("wall_mm"), section.get("thickness_mm"), size) if x)
        # Points are exact on the faces and the outline is cut exactly: the tolerance is the model's own, never a share of a thin wall.
        on_tol = max(tol, min(0.005 * size, 0.05 * thin))
        outlines = [cut["outer"]] + cut["inners"]
        face_class = classify_faces(cl, outlines, meshes, faces, on_tol)
        area = {m.index: m.area for m in meshes}
        total = sum(area.values()) or 1.0
        stock_ids = sorted(i for i, c in face_class.items() if c["stock"])
        feature_ids = sorted(i for i, c in face_class.items() if not c["stock"])
        stock_fraction = sum(area[i] for i in stock_ids) / total

        length = cl.length
        adj = _adjacency(shape, faces)
        end_zone = max(2 * on_tol, 0.5)
        holes: List[Dict[str, Any]] = []
        ends: List[Dict[str, Any]] = []
        forms: List[Dict[str, Any]] = []
        complex_holes: List[Dict[str, Any]] = []
        cutouts: List[Dict[str, Any]] = []
        by_index = {m.index: m for m in meshes}
        for group in _groups(feature_ids, adj):
            lo = min(face_class[i]["station"][0] for i in group)
            hi = max(face_class[i]["station"][1] for i in group)
            at_start = not cl.closed and lo <= end_zone
            at_end = not cl.closed and hi >= length - end_zone
            if at_start or at_end:
                which = "start" if at_start and not at_end else "end" if at_end and not at_start else ("start" if lo <= length - hi else "end")
                seg = cl.segments[0] if which == "start" else cl.segments[-1]
                # Out of the part at this end.
                t = scale(seg.tangent(0.0), -1.0) if which == "start" else seg.tangent(seg.length)
                ref = seg.point(0.0) if which == "start" else seg.point(seg.length)
                reach, span = {}, {}
                for i in group:
                    m = by_index.get(i)
                    if m is not None:
                        pts = _vertices(m)
                        reach[i] = max((norm(sub(sub(p, ref), scale(t, dot(sub(p, ref), t)))) for p in pts), default=0.0)
                        along = [dot(sub(p, ref), t) for p in pts]
                        span[i] = (max(along) - min(along)) if along else 0.0
                ftype, variant, angle = _end_kind(group, info, t, section, tol, reach, span)
                entry = {"end": which, "feature_type": ftype, "variant": variant, "face_ids": group, "cut_angle_deg": angle,
                         "cut_perimeter_mm": section["outer_perimeter_mm"]}
                (forms if ftype == "Form" else ends).append(entry)
                if ftype == "Form":
                    # A formed end is also cut: its cut is the end of the formed length.
                    ends.append({"end": which, "feature_type": "End", "variant": "square", "face_ids": group, "cut_angle_deg": 0.0,
                                 "cut_perimeter_mm": section["outer_perimeter_mm"], "formed": variant})
                continue
            hole = _hole(group, info, by_index, tol)
            station = round((lo + hi) / 2.0, 3)
            if hole is not None:
                holes.append({**hole, "face_ids": group, "station_mm": station})
                continue
            perim = _edge_length_between(shape, faces, group, stock_ids) / 2.0
            entry = {"face_ids": group, "station_mm": station, "perimeter_mm": round(perim, 3)}
            if _inner_wire_edges_touch(shape, faces, stock_ids, group):
                complex_holes.append(entry)
            else:
                cutouts.append(entry)
        for which in ("start", "end"):
            if not cl.closed and not any(e["end"] == which for e in ends):
                # An end with no face of its own (a free end whose cap is flush with the section) is a square cut.
                ends.append({"end": which, "feature_type": "End", "variant": "square", "face_ids": [], "cut_angle_deg": 0.0,
                             "cut_perimeter_mm": section["outer_perimeter_mm"]})
        ends.sort(key=lambda e: 0 if e["end"] == "start" else 1)

        bends = describe_bends(cl)
        unique = {(round(b["clr_mm"] * 2) / 2, round(b["angle_deg"])) for b in bends}
        bend_faces = sorted({i for b in bends for i in b["face_ids"]})
        features = _features(info, stock_ids, bends, holes, ends, forms, complex_holes, cutouts, cl.closed)
        measurements = {
            "developed_length": _m(round(length, 3), "mm", "the centreline: straights and bend arcs, end to end", stock_ids),
            "section_area": _m(section["area_mm2"], "mm2", "the cross-section cut normal to the centreline", stock_ids),
            "section_width": _m(section["width_mm"], "mm", "the section's outside size", stock_ids),
        }
        if section.get("wall_mm") is not None:
            measurements["wall_thickness"] = _m(section["wall_mm"], "mm", "outside less inside size, halved", stock_ids)
        if bends:
            measurements["bend_count"] = _m(len(bends), "count", "the bends along the centreline", bend_faces)
        return {
            "stock_form": section["stock_form"],
            "section": section,
            "stock_fraction": round(stock_fraction, 4),
            "developed_length_mm": round(length, 3),
            "closed_ring": cl.closed,
            "centreline": [{"kind": s.kind, "start_mm": round(s.start, 3), "length_mm": round(s.length, 3)} for s in cl.segments],
            "bends": bends,
            "bend_count": len(bends),
            "unique_bend_count": len(unique),
            "unique_clr_count": len({u[0] for u in unique}),
            "holes": holes,
            "complex_holes": complex_holes,
            "cutouts": cutouts,
            "ends": ends,
            "forms": forms,
            "stock_face_ids": stock_ids,
            "features": features,
            "measurements": measurements,
        }


def _m(value: Any, unit_: str, method: str, face_ids: Sequence[int]) -> Dict[str, Any]:
    return {"value": value, "unit": unit_, "method": method, "occurrences": [{"face_ids": sorted(face_ids)}], "reconciles": True}


def _stock_face_features(info: Sequence[Dict[str, Any]], ids: Sequence[int], stable: Dict[int, str]) -> List[Dict[str, Any]]:
    kinds = {"plane": "PlanarFace", "cylinder": "CurvedWall"}
    by: Dict[str, List[int]] = {}
    for i in ids:
        by.setdefault(kinds.get(info[i]["type"], "CurvedSurface"), []).append(i)
    return [{"id": k.lower(), "feature_type": k, "variant": "as_supplied", "occurrences": [{"face_ids": [i]} for i in v]} for k, v in sorted(by.items())]


def _features(info, stock_ids, bends, holes, ends, forms, complex_holes, cutouts, closed) -> List[Dict[str, Any]]:
    out: List[Dict[str, Any]] = []
    bend_faces = {i for b in bends for i in b["face_ids"]}
    out += _stock_face_features(info, [i for i in stock_ids if i not in bend_faces], {})
    if bends:
        out.append({"id": "bend", "feature_type": "Bend", "variant": "default", "occurrences": [
            {"face_ids": b["face_ids"], "clr_mm": b["clr_mm"], "angle_deg": b["angle_deg"], "straight_before_mm": b["straight_before_mm"],
             "clock_angle_deg": b["clock_angle_deg"]} for b in bends]})
    for e in ends:
        out.append({"id": f"end-{e['end']}", "feature_type": "End", "variant": e["variant"], "occurrences": [
            {"face_ids": e["face_ids"], "end": e["end"], "cut_angle_deg": e["cut_angle_deg"], "cut_perimeter_mm": e["cut_perimeter_mm"]}]})
    for f in forms:
        out.append({"id": f"form-{f['end']}", "feature_type": "Form", "variant": f["variant"], "occurrences": [{"face_ids": f["face_ids"], "end": f["end"]}]})
    for i, h in enumerate(holes):
        occ = {"face_ids": h["face_ids"], "diameter_mm": h["diameter_mm"], "depth_mm": h["depth_mm"], "axis": h["axis"], "station_mm": h["station_mm"]}
        if h.get("steps"):
            occ["steps"] = h["steps"]
        out.append({"id": f"hole-{i}", "feature_type": h["feature_type"], "variant": "stepped" if h["feature_type"] == "MultiStepHole" else "through",
                    "occurrences": [occ]})
    if complex_holes:
        out.append({"id": "complex-hole", "feature_type": "ComplexHole", "variant": "default", "occurrences": [
            {"face_ids": c["face_ids"], "perimeter_mm": c["perimeter_mm"], "station_mm": c["station_mm"]} for c in complex_holes]})
    if cutouts:
        out.append({"id": "cutout", "feature_type": "Cutout", "variant": "default", "occurrences": [
            {"face_ids": c["face_ids"], "perimeter_mm": c["perimeter_mm"], "station_mm": c["station_mm"]} for c in cutouts]})
    if closed:
        out.append({"id": "ring", "feature_type": "Ring", "variant": "as_supplied", "occurrences": [{"face_ids": sorted(stock_ids)}]})
    return out


def _add_stable(features: List[Dict[str, Any]], stable: Dict[int, str]) -> None:
    for f in features:
        for o in f["occurrences"]:
            s = [stable.get(i) for i in o.get("face_ids", [])]
            if s and all(s):
                o["source_face_stable_ids"] = s
