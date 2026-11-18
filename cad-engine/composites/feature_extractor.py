"""
What a laid-up composite part's cost rests on, measured from the solid.

A composite part (prepreg plies laid on a one-sided tool, bagged and cured in an autoclave) is a shell: two skins, the tool side (the face
laid on the tool) and the bag side, a few millimetres apart, joined by narrow edge strips (the trimmed edge, the walls of cutouts and holes).
A STEP solid carries no ply book, so what the plies are is read from the shape of the laminate:

  layup_direction     the direction the part is laid up along (the tool faces it): the one that leaves the least surface covered from it,
                      and of equal ones the one with the larger outline (the molding analysis's pull direction).
  surfaces            each face is a skin face or an edge strip: an edge strip is as narrow as the laminate behind it is thick. The skins are
                      split into the tool side (the largest connected skin, smoothest of equal ones) and the bag side (every other skin face).
  thickness_levels    the laminate thickness behind each bag-side face (largest ball, shared wall-thickness measure), grouped into levels.
                      Level j is the region at least that thick, with its area and boundary length: a ply that needs the laminate that
                      thick covers that region (ply drop-offs), and a level far thicker than the skins is a sandwich core. Which plies
                      and which core are decided in the backend from the material's ply thickness; nothing here knows a ply thickness.
  outline             the tool side seen along the layup direction: the outer area, the trim length (outer boundary), the footprint and
                      height (tool and autoclave fit), and the openings in it (cutouts), whose share of the outline is the cutout rating.
  curvature           per tool-side face, its largest principal curvature (1/m); the area-weighted average and the maximum: the ply
                      deformation rating of the layup processes.
  holes               holes through the laminate with their diameter (core potting, the holes a ply does not cut).

These are measurements only. Ply count, core, cycle times and cost are decided in the backend from the staged composites reference data.
"""
from __future__ import annotations

import logging
import math
from typing import Any, Dict, List, Optional, Sequence, Set, Tuple

from injection_molding.recognition.holes import recognize_holes
from injection_molding.recognition.mesh import FaceMesh, tessellate_faces
from injection_molding.recognition.pull_direction import choose_pull_direction
from injection_molding.recognition.vec import Vec, cross, dot, unit
from injection_molding.recognition.wall_thickness import measure_wall_thickness
from shared.casting_geometry import _faces
from shared.stable_face_id import build_stable_face_id_map
from forging.feature_extractor import extreme_faces, hole_features

logger = logging.getLogger(__name__)

VERSION = "composites-1"

# Geometric, not a design rule: a surface within this of parallel to the layup direction is a side wall (the molding analysis's number).
SIDE_WALL_DEG = 0.3
# An edge strip is no wider than this many times the laminate thickness behind it (a strip's width is twice its area over its perimeter).
EDGE_STRIP_WIDTH_FACTOR = 1.5
# Two bag-side thicknesses within this are one level: the larger of 0.05 mm and 2 % (the ball measurement's own scatter on one face).
LEVEL_TOLERANCE_MM = 0.05
LEVEL_TOLERANCE_FRACTION = 0.02
# Principal curvature sampled on this grid of each face's parameter range.
CURVATURE_GRID = 5


def _edge_topology(shape: Any) -> Tuple[Dict[int, float], Dict[int, List[int]], Dict[int, float]]:
    """Each face's boundary length (mm); for each edge (by ordinal) the faces it bounds (by face ordinal, TopExp_Explorer order); each edge's length."""
    from OCC.Core.BRepGProp import brepgprop  # type: ignore
    from OCC.Core.GProp import GProp_GProps  # type: ignore
    from OCC.Core.TopAbs import TopAbs_EDGE, TopAbs_FACE  # type: ignore
    from OCC.Core.TopExp import TopExp_Explorer, topexp  # type: ignore
    from OCC.Core.TopTools import TopTools_IndexedDataMapOfShapeListOfShape, TopTools_ListIteratorOfListOfShape  # type: ignore

    faces = _faces(shape)
    index_of: Dict[int, List[Tuple[Any, int]]] = {}
    for i, f in enumerate(faces):
        index_of.setdefault(hash(f), []).append((f, i))

    def face_index(f: Any) -> Optional[int]:
        for g, i in index_of.get(hash(f), []):
            if g.IsSame(f):
                return i
        for i, g in enumerate(faces):  # a hash that differs for the same face (orientation): the slow way
            if g.IsSame(f):
                return i
        return None

    emap = TopTools_IndexedDataMapOfShapeListOfShape()
    topexp.MapShapesAndAncestors(shape, TopAbs_EDGE, TopAbs_FACE, emap)
    edge_faces: Dict[int, List[int]] = {}
    edge_length: Dict[int, float] = {}
    for k in range(1, emap.Size() + 1):
        edge = emap.FindKey(k)
        props = GProp_GProps()
        brepgprop.LinearProperties(edge, props)
        edge_length[k] = float(props.Mass())
        ids: List[int] = []
        it = TopTools_ListIteratorOfListOfShape(emap.FindFromIndex(k))
        while it.More():
            i = face_index(it.Value())
            if i is not None and i not in ids:
                ids.append(i)
            it.Next()
        edge_faces[k] = ids
    perimeter: Dict[int, float] = {}
    for i, f in enumerate(faces):
        total = 0.0
        exp = TopExp_Explorer(f, TopAbs_EDGE)
        seen: Set[int] = set()
        while exp.More():
            k = emap.FindIndex(exp.Current())
            if k and k not in seen:
                seen.add(k)
                total += edge_length.get(k, 0.0)
            exp.Next()
        perimeter[i] = total
    return perimeter, edge_faces, edge_length


def classify_faces(meshes: Sequence[FaceMesh], thickness: Dict[int, float], perimeter: Dict[int, float]) -> Dict[int, str]:
    """'edge' for a face no wider than the laminate behind it (EDGE_STRIP_WIDTH_FACTOR), 'skin' otherwise. A face with no thickness is a skin."""
    out: Dict[int, str] = {}
    for f in meshes:
        t = thickness.get(f.index)
        p = perimeter.get(f.index, 0.0)
        width = 2.0 * f.area / p if p > 0 else math.inf
        out[f.index] = "edge" if t is not None and width <= EDGE_STRIP_WIDTH_FACTOR * t else "skin"
    return out


def _components(nodes: Set[int], edge_faces: Dict[int, List[int]]) -> List[Set[int]]:
    """The connected groups of `nodes`, two faces being connected when an edge bounds both."""
    adj: Dict[int, Set[int]] = {n: set() for n in nodes}
    for ids in edge_faces.values():
        inside = [i for i in ids if i in nodes]
        for a in inside:
            for b in inside:
                if a != b:
                    adj[a].add(b)
    out: List[Set[int]] = []
    left = set(nodes)
    while left:
        start = left.pop()
        comp, stack = {start}, [start]
        while stack:
            for b in adj[stack.pop()]:
                if b in left:
                    left.discard(b)
                    comp.add(b)
                    stack.append(b)
        out.append(comp)
    return out


def split_skins(meshes: Sequence[FaceMesh], kinds: Dict[int, str], edge_faces: Dict[int, List[int]], direction: Vec) -> Tuple[Set[int], Set[int]]:
    """
    (tool side, bag side). The tool side is the largest connected skin: the surface the tool defines is one smooth piece, while the bag side
    is broken by ply drop-offs and cores. Of two equal ones (a flat plate), the one with fewer faces, then the one facing against the layup
    direction (the part lies on the tool, laid up from above).
    """
    area = {f.index: f.area for f in meshes}
    normal: Dict[int, float] = {}
    for f in meshes:
        a = sum(t.area for t in f.triangles)
        normal[f.index] = sum(dot(t.normal, direction) * t.area for t in f.triangles) / a if a > 0 else 0.0
    skins = {i for i, k in kinds.items() if k == "skin"}
    comps = _components(skins, edge_faces)
    if not comps:
        return set(), set()
    total = lambda c: sum(area.get(i, 0.0) for i in c)  # noqa: E731
    facing = lambda c: sum(normal.get(i, 0.0) * area.get(i, 0.0) for i in c) / max(total(c), 1e-9)  # noqa: E731
    largest = max(total(c) for c in comps)
    near = [c for c in comps if total(c) >= 0.99 * largest]
    tool = sorted(near, key=lambda c: (len(c), facing(c)))[0]
    return tool, skins - tool


def step_faces(edges: Set[int], tool: Set[int], bag: Set[int], edge_faces: Dict[int, List[int]]) -> Dict[int, Set[int]]:
    """
    The edge strips inside the laminate (the wall of a ply drop-off or of a core): those that touch no tool-side face, each with the bag faces
    it joins. The trimmed edge and a cutout's wall run through the whole laminate and touch the tool side.
    """
    touches: Dict[int, Set[int]] = {i: set() for i in edges}
    for ids in edge_faces.values():
        for i in ids:
            if i in touches:
                touches[i].update(j for j in ids if j != i)
    return {i: {j for j in near if j in bag} for i, near in touches.items() if not (near & tool)}


def thickness_levels(bag: Set[int], area: Dict[int, float], thickness: Dict[int, float], edge_faces: Dict[int, List[int]],
                     edge_length: Dict[int, float], hole_faces: Set[int], steps: Optional[Dict[int, Set[int]]] = None) -> List[Dict[str, Any]]:
    """
    The bag side's thickness levels, thinnest first. Each level's faces are those whose thickness falls in it; its region is every bag face at
    least that thick, with the region's area and the length of its boundary (an edge of a region face not shared with another region face),
    the walls of holes excepted: a ply is cut to the region's outline, and holes are drilled after cure. A step wall inside the laminate
    (`steps`) whose bag faces are all in the region is inside it, not on its boundary: the plies under a drop-off run on past it.
    """
    steps = steps or {}
    faces = sorted((i for i in bag if i in thickness), key=lambda i: thickness[i])
    bands: List[List[int]] = []
    for i in faces:
        t = thickness[i]
        if bands and t - thickness[bands[-1][0]] <= max(LEVEL_TOLERANCE_MM, LEVEL_TOLERANCE_FRACTION * thickness[bands[-1][0]]):
            bands[-1].append(i)
        else:
            bands.append([i])
    out: List[Dict[str, Any]] = []
    for j, band in enumerate(bands):
        region = {i for b in bands[j:] for i in b}
        boundary = 0.0
        for k, ids in edge_faces.items():
            inside = [i for i in ids if i in region]
            if not inside:
                continue
            others = [i for i in ids if i not in region]
            interior = any(o in steps and steps[o] and steps[o] <= region for o in others)
            if len(inside) == 1 and not interior and not any(o in hole_faces for o in others):
                boundary += edge_length.get(k, 0.0)
        band_area = sum(area.get(i, 0.0) for i in band)
        out.append({
            "thickness_mm": round(max(thickness[i] for i in band), 3),
            "band_thickness_mm": [round(min(thickness[i] for i in band), 3), round(max(thickness[i] for i in band), 3)],
            "band_area_mm2": round(band_area, 2),
            "region_area_mm2": round(sum(area.get(i, 0.0) for i in region), 2),
            "region_perimeter_mm": round(boundary, 2),
            "face_ids": sorted(band),
        })
    return out


def outline(meshes: Sequence[FaceMesh], faces: Set[int], direction: Vec) -> Dict[str, Any]:
    """The faces seen along `direction`: outer area, outer boundary length, openings (count, area), footprint and the extent along it."""
    from shapely.geometry import Polygon  # type: ignore
    from shapely.ops import unary_union  # type: ignore

    n = unit(direction)
    helper: Vec = (1.0, 0.0, 0.0) if abs(n[0]) < 0.9 else (0.0, 1.0, 0.0)
    u = unit(cross(n, helper))
    v = cross(n, u)
    polys = []
    lo, hi = math.inf, -math.inf
    for f in meshes:
        for t in f.triangles:
            for p in t.vertices:
                d = dot(p, n)
                lo, hi = min(lo, d), max(hi, d)
            if f.index not in faces:
                continue
            poly = Polygon([(dot(p, u), dot(p, v)) for p in t.vertices])
            if poly.area > 1e-9:
                polys.append(poly.buffer(1e-6))
    if not polys:
        return {"outer_area_mm2": 0.0, "net_area_mm2": 0.0, "trim_length_mm": 0.0, "openings": [], "footprint_mm": [0.0, 0.0], "height_mm": 0.0}
    union = unary_union(polys)
    parts = list(union.geoms) if hasattr(union, "geoms") else [union]
    outer = sum(Polygon(p.exterior).area for p in parts)
    openings = [{"area_mm2": round(Polygon(r).area, 2), "perimeter_mm": round(r.length, 2)} for p in parts for r in p.interiors if Polygon(r).area > 1.0]
    minx, miny, maxx, maxy = union.bounds
    # The footprint long side first, with the in-plane direction each is measured along (for the faces at its two ends).
    sides = sorted([(maxx - minx, u), (maxy - miny, v)], key=lambda x: -x[0])
    return {
        "outer_area_mm2": round(outer, 2), "net_area_mm2": round(union.area, 2),
        "trim_length_mm": round(sum(p.exterior.length for p in parts), 2),
        "openings": sorted(openings, key=lambda o: -o["area_mm2"]),
        "footprint_mm": [round(sides[0][0], 3), round(sides[1][0], 3)],
        "footprint_axes": [[round(c, 6) for c in sides[0][1]], [round(c, 6) for c in sides[1][1]]],
        "height_mm": round(hi - lo, 3),
    }


def face_curvature(shape: Any, ids: Set[int]) -> Dict[int, float]:
    """Each face's largest principal curvature (1/m) over a CURVATURE_GRID x CURVATURE_GRID grid of its parameter range; a plane is 0."""
    from OCC.Core.BRepAdaptor import BRepAdaptor_Surface  # type: ignore
    from OCC.Core.BRepLProp import BRepLProp_SLProps  # type: ignore
    from OCC.Core.GeomAbs import GeomAbs_Plane  # type: ignore

    out: Dict[int, float] = {}
    for i, f in enumerate(_faces(shape)):
        if i not in ids:
            continue
        s = BRepAdaptor_Surface(f, True)
        if s.GetType() == GeomAbs_Plane:
            out[i] = 0.0
            continue
        u0, u1, v0, v1 = s.FirstUParameter(), s.LastUParameter(), s.FirstVParameter(), s.LastVParameter()
        best = 0.0
        for a in range(CURVATURE_GRID):
            for b in range(CURVATURE_GRID):
                uu = u0 + (u1 - u0) * (a + 0.5) / CURVATURE_GRID
                vv = v0 + (v1 - v0) * (b + 0.5) / CURVATURE_GRID
                try:
                    props = BRepLProp_SLProps(s, uu, vv, 2, 1e-6)
                    if props.IsCurvatureDefined():
                        best = max(best, abs(props.MaxCurvature()), abs(props.MinCurvature()))
                except Exception:  # a singular point (a cone's apex) has no curvature to read
                    continue
        out[i] = round(best * 1000.0, 4)  # 1/mm -> 1/m
    return out


def curvature_summary(curv: Dict[int, float], area: Dict[int, float]) -> Dict[str, Any]:
    """Area-weighted average and maximum curvature (1/m) of the faces, and the share of their area within 10 % of the maximum."""
    total = sum(area.get(i, 0.0) for i in curv)
    if total <= 0:
        return {"average_per_m": None, "max_per_m": None, "near_max_area_fraction": None, "faces": []}
    peak = max(curv.values()) if curv else 0.0
    near = sum(area.get(i, 0.0) for i, k in curv.items() if peak > 0 and k >= 0.9 * peak)
    return {
        "average_per_m": round(sum(k * area.get(i, 0.0) for i, k in curv.items()) / total, 4),
        "max_per_m": round(peak, 4),
        "near_max_area_fraction": round(near / total, 4) if peak > 0 else 0.0,
        "faces": [{"face_id": i, "curvature_per_m": k} for i, k in sorted(curv.items())],
    }


def laminate_measurements(meshes: Sequence[FaceMesh], tool: Set[int], bag: Set[int], trim_faces: Set[int], area: Dict[int, float],
                          shape_outline: Dict[str, Any], direction: Vec, tol: float) -> Dict[str, Any]:
    """
    The faces behind each number the composites cost reads, as feature_graph_v2 measurements (the calculator dialog's eye highlights them):
    the tool side's area, the trimmed edge (the edge strips that run through the laminate), both skins, the height along the layup direction
    and the footprint's length and width (the faces at the two ends of each).
    """
    out: Dict[str, Any] = {
        "tool_area": {"value": round(sum(area[i] for i in tool), 3), "unit": "mm2", "method": "the tool side's faces",
                      "occurrences": [{"face_ids": sorted(tool)}], "reconciles": True},
        "trim_length": {"value": shape_outline["trim_length_mm"], "unit": "mm", "method": "the edge strips the laminate is trimmed along",
                        "occurrences": [{"face_ids": sorted(trim_faces)}], "reconciles": bool(trim_faces)},
        "skin_area": {"value": round(sum(area[i] for i in tool | bag), 3), "unit": "mm2", "method": "both skins of the laminate",
                      "occurrences": [{"face_ids": sorted(tool | bag)}], "reconciles": True},
        "layup_height": {"value": shape_outline["height_mm"], "unit": "mm", "method": "faces at the two extremes along the layup direction",
                         "occurrences": [{"face_ids": extreme_faces(meshes, direction, tol)}], "reconciles": True},
    }
    axes = shape_outline.get("footprint_axes") or []
    for key, i in (("footprint_length", 0), ("footprint_width", 1)):
        if len(axes) > i:
            out[key] = {"value": shape_outline["footprint_mm"][i], "unit": "mm", "method": "faces at the two ends of the outline",
                        "occurrences": [{"face_ids": extreme_faces(meshes, tuple(axes[i]), tol)}], "reconciles": True}
    return out


def skin_features(tool: Set[int], levels: Sequence[Dict[str, Any]], edges: Set[int], stable: Dict[int, str]) -> List[Dict[str, Any]]:
    """The tool surface, each thickness level and the edge strips as feature_graph_v2 features, for the process tree and the 3D highlight."""
    def occ(ids: Sequence[int], **extra: Any) -> Dict[str, Any]:
        o: Dict[str, Any] = {"face_ids": sorted(ids), **extra}
        s = [stable.get(i) for i in o["face_ids"]]
        if s and all(s):
            o["source_face_stable_ids"] = s
        return o
    out: List[Dict[str, Any]] = []
    if tool:
        out.append({"id": "tool-surface", "feature_type": "ToolSurface", "variant": "default", "occurrences": [occ(sorted(tool))]})
    if levels:
        out.append({"id": "laminate-zones", "feature_type": "LaminateZone", "variant": "default", "occurrences": [
            occ(l["face_ids"], thickness_mm=l["thickness_mm"], area_mm2=l["band_area_mm2"]) for l in levels]})
    if edges:
        out.append({"id": "trim-edge", "feature_type": "TrimEdge", "variant": "default", "occurrences": [occ(sorted(edges))]})
    return out


class CompositeFeatureExtractor:
    def extract(
        self,
        shape: Any,
        bbox_dims: Sequence[float],
        face_map: Optional[List[Any]] = None,
        face_map_tri_total: int = 0,
        layup_direction_override: Optional[Tuple[float, float, float]] = None,
    ) -> Dict[str, Any]:
        diagonal = math.sqrt(sum(float(x) ** 2 for x in bbox_dims))
        deflection = max(0.05, diagonal * 0.001)
        meshes = tessellate_faces(shape, linear_deflection=deflection)
        layup = choose_pull_direction(meshes, SIDE_WALL_DEG, layup_direction_override)
        direction = layup.vector
        wall = measure_wall_thickness(meshes, deflection)
        thickness = {f["face_id"]: f["thickness_mm"] for f in wall["faces"]}
        perimeter, edge_faces, edge_length = _edge_topology(shape)
        kinds = classify_faces(meshes, thickness, perimeter)
        holes = recognize_holes(meshes, direction)
        hole_faces = {i for h in holes["holes"] for i in h["face_ids"]}
        for i in hole_faces:
            kinds[i] = "edge"  # a hole's wall is an edge of the laminate whatever its width
        tool, bag = split_skins(meshes, kinds, edge_faces, direction)
        area = {f.index: f.area for f in meshes}
        edges = {i for i, k in kinds.items() if k == "edge"} - hole_faces
        levels = thickness_levels(bag, area, thickness, edge_faces, edge_length, hole_faces, step_faces(edges, tool, bag, edge_faces))
        shape_outline = outline(meshes, tool, direction)
        curv = curvature_summary(face_curvature(shape, tool), area)

        stable: Dict[int, str] = {}
        try:
            stable = build_stable_face_id_map(shape)
        except Exception as e:  # the ids only serve highlighting; a part that cannot be hashed is still measured
            logger.warning(f"[Composites] stable_face_id build failed: {e}")
        features = hole_features(holes["holes"], stable) + skin_features(tool, levels, edges, stable)
        skin_t = levels[0]["thickness_mm"] if levels else None

        logger.info(
            f"[Composites] layup={[round(c, 3) for c in direction]} ({layup.source}) tool_area={sum(area[i] for i in tool):.0f}mm2 "
            f"levels={[l['thickness_mm'] for l in levels]} trim={shape_outline['trim_length_mm']}mm openings={len(shape_outline['openings'])} "
            f"holes={len(holes['holes'])} curvature_max={curv['max_per_m']}/m"
        )
        return {
            "extraction_version": VERSION,
            "layup_direction": {
                "vector": [round(c, 5) for c in direction], "source": layup.source, "axis": layup.nearest_axis(),
                "undercut_area_mm2": round(layup.undercut_area_mm2, 2),
            },
            "surfaces": {
                "tool_area_mm2": round(sum(area[i] for i in tool), 2), "bag_area_mm2": round(sum(area[i] for i in bag), 2),
                "edge_area_mm2": round(sum(area[i] for i in edges), 2),
                "tool_face_ids": sorted(tool), "bag_face_ids": sorted(bag), "edge_face_ids": sorted(edges),
            },
            "thickness": {
                "skin_mm": skin_t, "max_mm": levels[-1]["thickness_mm"] if levels else None,
                "resolution_mm": wall["resolution_mm"], "levels": levels,
            },
            "outline": shape_outline,
            "curvature": curv,
            "holes": [
                {"id": h["id"], "variant": h["variant"], "diameter_mm": h["diameter_mm"], "depth_mm": h["depth_mm"],
                 "angle_to_layup_deg": h["angle_to_pull_deg"], "face_ids": h["face_ids"]}
                for h in holes["holes"]
            ],
            "feature_graph_v2": {
                "metadata": {"face_map": face_map or [], "stl_tri_total": face_map_tri_total or None, "stable_face_ids": stable},
                "features": features,
                "conditions": [],
                "measurements": laminate_measurements(
                    meshes, tool, bag, {i for i in edges if any(i in ids and any(j in tool for j in ids) for ids in edge_faces.values())},
                    area, shape_outline, direction, deflection * 2.0),
            },
        }
