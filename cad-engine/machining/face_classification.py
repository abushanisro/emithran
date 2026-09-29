"""
General milled-face surface classification — Phase 3 of the machining
feature-extraction plan.

WHY THIS EXISTS

PlanarFace / CurvedWall / CurvedSurface together are 459 of the real 1126
operation rows in memory/machining/operations_full__operations.csv (41%) —
every "Fine Finish Milling / General Mill Finishing / Mill Contouring /
Side Milling"-family operation resolves to one of these three real
geometric classifications at a different real process pass. No code
anywhere in this codebase classified a milled face by real surface type
before this module (confirmed by grep before writing it).

WHAT THIS DOES

For a milled part's faces NOT already claimed by a discrete detector (hole
walls, counterbore/countersink/chamfer cones, fillet/groove toroids, pocket/
slot/keyway floors), classifies each remaining face by its real OCC surface
type:
  - GeomAbs_Plane                          -> "PlanarFace"
  - GeomAbs_Cylinder / Cone / Torus        -> "CurvedWall"
  - GeomAbs_BSplineSurface / BezierSurface -> "CurvedSurface"
Any other real surface type (GeomAbs_Sphere, SurfaceOfRevolution,
SurfaceOfExtrusion, OffsetSurface) is a disclosed, genuinely unclassified
gap here -- never silently bucketed into the nearest guess.

Contiguous same-classified faces (connected via a shared real edge) are
grouped into ONE machinable region per connected component, not emitted as
one feature per raw face -- a milled top face made of several NURBS patches
must not look like dozens of distinct "PlanarFace" features. This grouping
is real geometric adjacency work (shared-edge topology), the same technique
sheet_metal/bend_relationships.py already uses for Sheet Metal.

WHAT THIS DELIBERATELY DOES NOT DO

- Does not compute operation names -- callers resolve those downstream
  through the existing DB-driven resolveMachiningOperationCategories /
  resolveOperationName machinery, same as every other detector in this
  file. This module only reports real geometry.
- Does not fabricate a removed-volume figure for a region -- classifying a
  face does not by itself reveal how much stock sat above it before
  machining; material_removed_mm3 is left at a disclosed 0.0 by the
  synthesis layer (build_machining_feature_graph_v2), same discipline
  already used for toroid (fillet/groove) regions.
- Does not attempt turned parts -- turned-part Rough/Finish Turning already
  resolves PlanarFace/CurvedWall/CurvedSurface operation names from real
  aggregate per-pass turning physics (cost-cnc-engine.ts's
  computeTurningCycleSec), a different, already-real mechanism; this module
  is scoped to the milled path only, per the plan's own scoping.

REAL OCC APIS USED (verified against pythonocc before writing this, not
guessed): TopExp.topexp.MapShapes builds a 1-based TopTools_IndexedMapOfShape
whose FindIndex(face) matches the SAME 0-based enumeration order every
face_idx elsewhere in this codebase already uses (index - 1); confirmed by
direct comparison against TopExp_Explorer's own traversal order on a real
box (see shared/stable_face_id.py's own doc comment for the underlying
assumption this relies on). topexp.MapShapesAndAncestors builds a real
edge -> ancestor-faces adjacency map (each manifold edge has exactly 2 real
ancestor faces).
"""
from __future__ import annotations

from typing import Any, Dict, List, Optional, Set, Tuple


# Two faces are the same real facing plane only if their normals point the
# same direction (not merely parallel -- opposite-facing coplanar faces,
# e.g. the two walls of a thin slot, are real distinct faces) and their
# offset from the origin along that normal matches -- real geometric
# coplanarity, not a guessed tolerance: 0.01 corresponds to a hundredth of a
# degree of normal misalignment and 0.01mm of plane offset, tight enough to
# reject any genuinely different real plane while tolerating STEP-level
# floating point noise.
_PLANE_NORMAL_DOT_TOL = 0.999
_PLANE_OFFSET_TOL_MM = 0.01

# Two adjacent planar faces are candidate polygon-ring members only if their
# real areas are within this fraction of the larger one -- real ring sides
# are congruent; this is what keeps an unrelated, much larger surrounding
# face (a socket's rim, a boss's base) from ever being treated as a ring
# member. See detect_polygon_rings' own doc comment.
_RING_EDGE_AREA_TOL_RATIO = 0.25

# A candidate ring whose own bbox extent matches the real part's own overall
# bbox extent (within this tolerance) on 2+ axes IS the part's own outer
# envelope, not a real localized feature -- see detect_polygon_rings' own
# doc comment for the confirmed false positive (a plain box's 4 sides) this
# closes.
_RING_PART_BBOX_TOL_MM = 0.5

# A planar face's normal is treated as "perpendicular to the datum axis"
# (a real side-wall candidate) when the absolute dot product with that axis
# is below this. Complements _collect_prismatic_pockets' own
# dot_with_axis > 0.85 "parallel" (floor/cap) threshold in
# machining_feature_recognizer.py, leaving a real dead zone (0.15-0.85) for
# genuinely ambiguous (neither clearly wall nor clearly cap) orientations.
_WALL_AXIS_DOT_TOL = 0.15

# A candidate wall ring is a genuine through-cutout only when its own span
# along the datum axis exceeds this fraction of the real part's own span --
# the same real through-vs-blind threshold _collect_cylinders already uses
# for through_hole vs blind_hole (machining_feature_recognizer.py), reused here
# rather than invented.
_CUTOUT_THROUGH_SPAN_RATIO = 0.90


def _planes_coincide(
    plane_a: Tuple[Tuple[float, float, float], float],
    plane_b: Tuple[Tuple[float, float, float], float],
) -> bool:
    (nax, nay, naz), oa = plane_a
    (nbx, nby, nbz), ob = plane_b
    dot = nax * nbx + nay * nby + naz * nbz
    return dot >= _PLANE_NORMAL_DOT_TOL and abs(oa - ob) < _PLANE_OFFSET_TOL_MM


def _is_parts_own_envelope(
    ring_bbox: Tuple[float, float, float, float, float, float],
    part_bbox: Dict[str, float],
) -> bool:
    """
    True when a candidate ring's own combined bbox matches the real part's
    own overall bbox on 2 or more axes -- i.e. the "ring" IS the part's own
    outer envelope (e.g. a plain box's 4 side walls, which independently
    satisfy a ring-detector's degree-2/congruence/through-span signals just
    as well as a genuine localized feature would), not a real feature
    within it. Shared by detect_polygon_rings and detect_cutout_rings --
    both found this exact same real false positive during verification.
    """
    xmin, ymin, zmin, xmax, ymax, zmax = ring_bbox
    matching_axes = 0
    for lo_key, hi_key, ring_lo, ring_hi in (
        ("xmin", "xmax", xmin, xmax),
        ("ymin", "ymax", ymin, ymax),
        ("zmin", "zmax", zmin, zmax),
    ):
        if (
            abs(ring_lo - part_bbox[lo_key]) < _RING_PART_BBOX_TOL_MM
            and abs(ring_hi - part_bbox[hi_key]) < _RING_PART_BBOX_TOL_MM
        ):
            matching_axes += 1
    return matching_axes >= 2


def _classify_surface_type(geomabs_type: Any) -> Optional[str]:
    from OCC.Core.GeomAbs import (  # type: ignore
        GeomAbs_Plane, GeomAbs_Cylinder, GeomAbs_Cone, GeomAbs_Torus,
        GeomAbs_BSplineSurface, GeomAbs_BezierSurface,
    )
    if geomabs_type == GeomAbs_Plane:
        return "PlanarFace"
    if geomabs_type in (GeomAbs_Cylinder, GeomAbs_Cone, GeomAbs_Torus):
        return "CurvedWall"
    if geomabs_type in (GeomAbs_BSplineSurface, GeomAbs_BezierSurface):
        return "CurvedSurface"
    return None


def _build_face_graph(shape, claimed_face_ids: Set[int]):
    """
    Shared low-level real face graph: every unclaimed face's real surface
    type + (for planar faces) real plane equation, plus real same-type
    adjacency (shared real edge, no coplanarity filter applied here --
    callers apply their own further filtering; e.g. region-grouping below
    requires coplanarity for planar_face pairs, but detect_polygon_rings
    deliberately does not, since polygon sides are non-coplanar by
    definition).

    Returns (faces, surface_type, plane_eq, adjacency) -- see
    classify_and_group_milled_faces' own doc comment for the real OCC APIs
    used and why FindIndex(face) - 1 matches every other face_idx in this
    codebase.
    """
    from OCC.Core.BRepAdaptor import BRepAdaptor_Surface  # type: ignore
    from OCC.Core.TopExp import TopExp_Explorer, topexp  # type: ignore
    from OCC.Core.TopAbs import TopAbs_FACE, TopAbs_EDGE  # type: ignore
    from OCC.Core.TopTools import (  # type: ignore
        TopTools_IndexedMapOfShape,
        TopTools_IndexedDataMapOfShapeListOfShape,
        TopTools_ListIteratorOfListOfShape,
    )
    from OCC.Core.TopoDS import topods  # type: ignore

    face_index_map = TopTools_IndexedMapOfShape()
    topexp.MapShapes(shape, TopAbs_FACE, face_index_map)

    faces: Dict[int, Any] = {}
    surface_type: Dict[int, str] = {}
    plane_eq: Dict[int, Tuple[Tuple[float, float, float], float]] = {}
    exp = TopExp_Explorer(shape, TopAbs_FACE)
    idx = 0
    while exp.More():
        face = topods.Face(exp.Current())
        faces[idx] = face
        if idx not in claimed_face_ids:
            adaptor = BRepAdaptor_Surface(face)
            ftype = _classify_surface_type(adaptor.GetType())
            if ftype:
                surface_type[idx] = ftype
                if ftype == "PlanarFace":
                    plane = adaptor.Plane()
                    n = plane.Axis().Direction()
                    loc = plane.Location()
                    normal = (n.X(), n.Y(), n.Z())
                    offset = n.X() * loc.X() + n.Y() * loc.Y() + n.Z() * loc.Z()
                    plane_eq[idx] = (normal, offset)
        idx += 1
        exp.Next()

    edge_face_map = TopTools_IndexedDataMapOfShapeListOfShape()
    topexp.MapShapesAndAncestors(shape, TopAbs_EDGE, TopAbs_FACE, edge_face_map)

    adjacency: Dict[int, Set[int]] = {i: set() for i in surface_type}
    for i in range(1, edge_face_map.Size() + 1):
        lst = edge_face_map.FindFromIndex(i)
        it = TopTools_ListIteratorOfListOfShape(lst)
        neighbor_idxs: List[int] = []
        while it.More():
            neighbor_idxs.append(face_index_map.FindIndex(it.Value()) - 1)
            it.Next()
        for a in neighbor_idxs:
            if a not in surface_type:
                continue
            for b in neighbor_idxs:
                if a != b and b in surface_type and surface_type[a] == surface_type[b]:
                    adjacency[a].add(b)

    return faces, surface_type, plane_eq, adjacency


def classify_and_group_milled_faces(shape, claimed_face_ids: Set[int]) -> List[Dict]:
    """
    Real, additive milled-face region detector.

    claimed_face_ids: face_idx values already consumed by another detector
    in this recognizer (hole walls, cone/chamfer/countersink, toroids,
    prismatic pocket floors, polygon rings) -- passed in by the caller as
    the union of every already-emitted feature's face_ids, so a hole's own
    cylindrical wall never also emits as a generic "CurvedWall" milling
    region.

    Returns a list of real region dicts:
      {feature_type, face_indices, area_mm2, centroid, bbox}
    one entry per connected group of same-classified, unclaimed faces.
    """
    from OCC.Core.BRepGProp import brepgprop  # type: ignore
    from OCC.Core.GProp import GProp_GProps  # type: ignore
    from OCC.Core.BRepBndLib import brepbndlib  # type: ignore
    from OCC.Core.Bnd import Bnd_Box  # type: ignore

    faces, surface_type, plane_eq, raw_adjacency = _build_face_graph(shape, claimed_face_ids)
    if not surface_type:
        return []

    # Region-grouping additionally requires coplanarity for planar_face
    # pairs -- two perpendicular faces (e.g. a box's top face and a side
    # wall) share an edge and the same coarse type, but are NOT the same
    # real facing plane, and must not merge into one fabricated region.
    # curved_wall/curved_surface stay pure adjacency (a filleted boss's
    # cylinder smoothly meeting its own rounded top IS one real continuous
    # machining region).
    adjacency: Dict[int, Set[int]] = {i: set() for i in surface_type}
    for a, neighbors in raw_adjacency.items():
        for b in neighbors:
            if surface_type[a] == "PlanarFace" and not _planes_coincide(plane_eq[a], plane_eq[b]):
                continue
            adjacency[a].add(b)

    # 3. Connected-component grouping (BFS) among same-type unclaimed faces.
    visited: Set[int] = set()
    regions: List[Dict] = []
    for start in surface_type:
        if start in visited:
            continue
        ftype = surface_type[start]
        stack = [start]
        component: List[int] = []
        visited.add(start)
        while stack:
            cur = stack.pop()
            component.append(cur)
            for nb in adjacency.get(cur, ()):
                if nb not in visited:
                    visited.add(nb)
                    stack.append(nb)

        # 4. Real aggregate area + real area-weighted centroid + real union bbox.
        total_area = 0.0
        wx = wy = wz = 0.0
        bnd = Bnd_Box()
        for fi in component:
            props = GProp_GProps()
            brepgprop.SurfaceProperties(faces[fi], props)
            area = props.Mass()
            cg = props.CentreOfMass()
            total_area += area
            wx += cg.X() * area
            wy += cg.Y() * area
            wz += cg.Z() * area
            brepbndlib.Add(faces[fi], bnd)
        if total_area <= 0:
            continue
        xmin, ymin, zmin, xmax, ymax, zmax = bnd.Get()

        regions.append({
            "feature_type": ftype,
            "face_indices": sorted(component),
            "area_mm2": round(total_area, 3),
            "centroid": (
                round(wx / total_area, 3),
                round(wy / total_area, 3),
                round(wz / total_area, 3),
            ),
            "bbox": {
                "xmin": round(xmin, 3), "ymin": round(ymin, 3), "zmin": round(zmin, 3),
                "xmax": round(xmax, 3), "ymax": round(ymax, 3), "zmax": round(zmax, 3),
            },
        })

    return regions


def detect_polygon_rings(
    shape,
    claimed_face_ids: Set[int],
    part_bbox: Optional[Dict[str, float]] = None,
) -> List[Dict]:
    """
    Emitted by MachiningFeatureRecognizer.recognize() only as
    MachiningFeatureTree.polygon_candidates -- never as features. The backend
    treats a candidate as a polygon only when the drawing carries a polygon
    callout (drawing_intelligence.polygon_callout), the additional signal
    this detector needs (product decision 2026-09-29). Real
    testing (test_polygon_rings.py) found this detector's own geometric
    signal CANNOT reliably distinguish a genuine rotary-broached polygon
    feature from an ordinary square/rectangular milled pocket -- both are,
    geometrically, a real closed ring of congruent-area, mutually adjacent
    planar walls; the difference between them is the intended tooling/
    process (a broach vs an end mill), not the shape. Confirmed live: an
    ordinary 20x15x8 pocket's own 4 walls (two pairs, areas 160mm^2/120mm^2
    -- within this function's own real area tolerances) satisfied every
    check below and were wrongly reported as a 4-sided "polygon". Do not
    wire this into _recognize_milled without a real additional signal
    (drawing-callout PMI, known drive-socket size standards) to tell the
    two cases apart.

    Real rotary-broached polygon (hex/square socket or boss) detector --
    "Polygon" / "Rotary Broaching" / "Polygon Turning", 18 real rows in
    memory/machining/operations_full__operations.csv. A polygon ring is a
    closed cycle of 3-12 real, mutually adjacent, congruent-area planar
    faces -- e.g. the 6 flat walls of a hex broach socket or hex boss.

    part_bbox: the real part's own overall bounding box (from
    _part_bounding_box), used for a confirmed-necessary negative check: a
    PLAIN BOX's own 4 side walls (between its top and bottom caps) satisfy
    the exact same degree-2 + congruent-area signature as a genuine ring --
    real, verified false positive found while building this detector. The
    real distinguishing fact is that a genuine feature is a small, LOCAL
    ring; the box's own sides span the entire part envelope. A candidate
    ring whose own bbox matches the part's own bbox on 2 or more axes (i.e.
    it IS the part's own outer envelope, not a feature within it) is
    rejected. Optional only for callers that lack it (skips this check,
    same disclosed-tradeoff convention as classify_and_group_milled_faces'
    own optional bbox param); every real call site in this file passes it.

    REAL DISCRIMINATING SIGNAL, NOT A GUESSED HEURISTIC: in a genuine
    N-sided prism ring, each side wall touches EXACTLY 2 other ring members
    of the SAME real congruent area (its two neighbors). A floor/cap face
    closing the end of the prism, or the larger surrounding face a socket's
    rim opens into, also touches every wall -- but at a real, substantially
    different area, confirmed directly (a 6-sided hex socket's own walls:
    80mm^2 each; the box's own surrounding top face: ~2800mm^2). Restricting
    candidate adjacency edges to area-compatible pairs (within
    _RING_EDGE_AREA_TOL_RATIO of each other) BEFORE looking for a ring
    means an unrelated, differently-sized neighbor can never masquerade as
    a ring member, without needing to know in advance which faces are real
    ring members (that would be circular). On this area-filtered graph,
    each true ring member has EXACTLY 2 same-congruent-area neighbors,
    while a floor/cap/surrounding face's edges to the ring are excluded
    entirely -- an ordinary box's own faces (verified directly:
    test_face_classification.py's own plain-box fixture; here, its own
    negative-control test) never form a ring under this rule since no
    accidental congruent-area cluster of 3-12 mutually adjacent faces
    exists on a plain box. Iteratively pruning any node with fewer than 2
    remaining edges (a real graph "2-core" decomposition) on this filtered
    graph leaves only genuine closed rings behind, WITHOUT needing to
    assume or compute an explicit polygon axis or angular spacing (which
    would need its own fragile heuristic). A final real congruent-area
    check (within 15% of the ring's own mean) on the surviving ring is a
    second, independent positive check.

    Scoped to the milled path only, same scoping as
    classify_and_group_milled_faces -- reuses the exact same real face-graph
    primitives (_build_face_graph). Callers must pass this detector's own
    claimed face_ids into classify_and_group_milled_faces afterward so a
    real ring's walls don't ALSO reappear as generic planar_face regions.
    """
    from OCC.Core.BRepGProp import brepgprop  # type: ignore
    from OCC.Core.GProp import GProp_GProps  # type: ignore
    from OCC.Core.BRepBndLib import brepbndlib  # type: ignore
    from OCC.Core.Bnd import Bnd_Box  # type: ignore

    faces, surface_type, _plane_eq, raw_adjacency = _build_face_graph(shape, claimed_face_ids)

    planar_nodes = {i for i, t in surface_type.items() if t == "PlanarFace"}
    if len(planar_nodes) < 3:
        return []

    # Real per-face area, needed before any ring logic so adjacency edges
    # can be filtered by area compatibility.
    face_area: Dict[int, float] = {}
    for fi in planar_nodes:
        props = GProp_GProps()
        brepgprop.SurfaceProperties(faces[fi], props)
        face_area[fi] = props.Mass()

    def _area_compatible(a: int, b: int) -> bool:
        aa, ab = face_area[a], face_area[b]
        if aa <= 0 or ab <= 0:
            return False
        return abs(aa - ab) / max(aa, ab) <= _RING_EDGE_AREA_TOL_RATIO

    graph: Dict[int, Set[int]] = {
        i: {
            n for n in raw_adjacency.get(i, ())
            if n in planar_nodes and _area_compatible(i, n)
        }
        for i in planar_nodes
    }

    # Real 2-core pruning: repeatedly remove any planar face with fewer than
    # 2 remaining same-type, area-compatible neighbors, until stable.
    remaining = set(planar_nodes)
    changed = True
    while changed:
        changed = False
        for node in list(remaining):
            if len(graph[node] & remaining) < 2:
                remaining.discard(node)
                changed = True

    if not remaining:
        return []

    visited: Set[int] = set()
    rings: List[Dict] = []
    for start in remaining:
        if start in visited:
            continue
        stack = [start]
        component: List[int] = []
        visited.add(start)
        while stack:
            cur = stack.pop()
            component.append(cur)
            for nb in graph[cur] & remaining:
                if nb not in visited:
                    visited.add(nb)
                    stack.append(nb)

        if not (3 <= len(component) <= 12):
            continue  # a real polygon has a sane, bounded number of sides

        component_set = set(component)
        # Every member of a genuine simple ring has EXACTLY 2 neighbors
        # within the component -- a connected graph where every node has
        # degree exactly 2 is always one single simple cycle. Reject a more
        # complex structure (e.g. two rings fused at a shared wall) rather
        # than guess which part is the real ring.
        if not all(len(graph[n] & component_set) == 2 for n in component):
            continue

        areas = [face_area[fi] for fi in component]
        mean_area = sum(areas) / len(areas)
        if mean_area <= 0 or any(abs(a - mean_area) / mean_area > 0.15 for a in areas):
            continue

        total_area = 0.0
        wx = wy = wz = 0.0
        bnd = Bnd_Box()
        for fi, area in zip(component, areas):
            props = GProp_GProps()
            brepgprop.SurfaceProperties(faces[fi], props)
            cg = props.CentreOfMass()
            total_area += area
            wx += cg.X() * area
            wy += cg.Y() * area
            wz += cg.Z() * area
            brepbndlib.Add(faces[fi], bnd)
        xmin, ymin, zmin, xmax, ymax, zmax = bnd.Get()

        if part_bbox is not None and _is_parts_own_envelope(
            (xmin, ymin, zmin, xmax, ymax, zmax), part_bbox
        ):
            # This "ring" IS the part's own outer envelope (e.g. a plain
            # box's 4 side walls), not a real localized feature -- see this
            # function's own doc comment for the confirmed false positive
            # this closes.
            continue

        rings.append({
            "face_indices": sorted(component),
            "side_count": len(component),
            **_polygon_ring_geometry(faces, component, face_area, (wx / total_area, wy / total_area, wz / total_area)),
            "area_mm2": round(total_area, 3),
            "centroid": (
                round(wx / total_area, 3),
                round(wy / total_area, 3),
                round(wz / total_area, 3),
            ),
            "bbox": {
                "xmin": round(xmin, 3), "ymin": round(ymin, 3), "zmin": round(zmin, 3),
                "xmax": round(xmax, 3), "ymax": round(ymax, 3), "zmax": round(zmax, 3),
            },
        })

    return rings


def _polygon_ring_geometry(faces, component, face_area, ring_centroid) -> Dict:
    """
    What a polygon ring is, from its own walls:
      axis             the direction every wall is parallel to (cross product of
                       two non-parallel wall normals)
      kind             "socket" when every wall's outward normal (the face's own
                       orientation applied) points toward the ring's centre --
                       material outside, a void inside (a broached hole); "boss"
                       when every one points away (material inside); else
                       "unknown"
      depth_mm         the walls' extent along the axis (their vertices)
      across_flats_mm  the distance between two opposite parallel walls; for an
                       odd side count (no opposite walls) the regular-polygon
                       value side / tan(pi / n), side = mean wall area / depth
    """
    from OCC.Core.BRepAdaptor import BRepAdaptor_Surface  # type: ignore
    from OCC.Core.BRepGProp import brepgprop  # type: ignore
    from OCC.Core.GProp import GProp_GProps  # type: ignore
    from OCC.Core.TopAbs import TopAbs_REVERSED, TopAbs_VERTEX  # type: ignore
    from OCC.Core.TopExp import TopExp_Explorer  # type: ignore
    from OCC.Core.BRep import BRep_Tool  # type: ignore
    from OCC.Core.TopoDS import topods  # type: ignore
    import math

    planes = []  # (outward unit normal, plane offset along it, face centroid)
    for fi in component:
        face = faces[fi]
        pl = BRepAdaptor_Surface(face).Plane()
        d = pl.Axis().Direction()
        n = [d.X(), d.Y(), d.Z()]
        if face.Orientation() == TopAbs_REVERSED:
            n = [-c for c in n]
        loc = pl.Location()
        offset = n[0] * loc.X() + n[1] * loc.Y() + n[2] * loc.Z()
        props = GProp_GProps()
        brepgprop.SurfaceProperties(face, props)
        cg = props.CentreOfMass()
        planes.append((n, offset, (cg.X(), cg.Y(), cg.Z())))

    axis = None
    for i in range(len(planes)):
        for j in range(i + 1, len(planes)):
            a, b = planes[i][0], planes[j][0]
            c = [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]
            norm = math.sqrt(sum(x * x for x in c))
            if norm > 0.1:
                axis = [x / norm for x in c]
                break
        if axis:
            break
    if axis is None:
        return {"kind": "unknown", "axis": None, "depth_mm": None, "across_flats_mm": None}

    signs = [
        n[0] * (cg[0] - ring_centroid[0]) + n[1] * (cg[1] - ring_centroid[1]) + n[2] * (cg[2] - ring_centroid[2])
        for n, _o, cg in planes
    ]
    kind = "socket" if all(x < 0 for x in signs) else "boss" if all(x > 0 for x in signs) else "unknown"

    proj = []
    for fi in component:
        exp = TopExp_Explorer(faces[fi], TopAbs_VERTEX)
        while exp.More():
            p = BRep_Tool.Pnt(topods.Vertex(exp.Current()))
            proj.append(p.X() * axis[0] + p.Y() * axis[1] + p.Z() * axis[2])
            exp.Next()
    depth = (max(proj) - min(proj)) if proj else None

    across = None
    for i in range(len(planes)):
        for j in range(i + 1, len(planes)):
            a, b = planes[i][0], planes[j][0]
            dot = a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
            if dot < -0.999:  # opposite walls: outward normals anti-parallel
                across = abs(planes[i][1] + planes[j][1])
                break
        if across is not None:
            break
    n_sides = len(component)
    if across is None and depth and depth > 0:
        side = (sum(face_area[fi] for fi in component) / n_sides) / depth
        across = side / math.tan(math.pi / n_sides)

    return {
        "kind": kind,
        "axis": [round(x, 6) for x in axis],
        "depth_mm": round(depth, 3) if depth is not None else None,
        "across_flats_mm": round(across, 3) if across is not None else None,
    }


def detect_cutout_rings(
    shape,
    claimed_face_ids: Set[int],
    datum_axis: Tuple[float, float, float],
    part_bbox: Optional[Dict[str, float]] = None,
) -> List[Dict]:
    """
    Real non-circular through-cutout detector -- "Cutout" (Perimeter
    Milling / Rough Milling / Routering on a milled part, 11 real rows in
    memory/machining/operations_full__operations.csv). A cutout is a closed
    ring of real, mutually adjacent planar wall faces whose combined span
    along the part's own datum axis reaches nearly the part's FULL
    thickness -- i.e. it genuinely goes all the way through, unlike an
    ordinary blind pocket. Reuses the exact same real through-vs-blind
    span-ratio signal _collect_cylinders already uses for through_hole vs
    blind_hole (> 90% of part_span), generalized from a single circular
    bore to a closed ring of planar walls.

    Real candidate wall faces are restricted to those whose normal is
    genuinely PERPENDICULAR to datum_axis (dot < _WALL_AXIS_DOT_TOL) -- the
    same real orientation split _collect_prismatic_pockets already uses in
    reverse (its own dot_with_axis > 0.85 selects axis-PARALLEL floor/cap
    candidates; this selects the complementary axis-PERPENDICULAR wall
    candidates). This is what keeps a part's own top/bottom/floor caps out
    of the ring-candidate graph in the first place, WITHOUT needing
    detect_polygon_rings' congruent-area trick -- real cutout walls are
    commonly NOT congruent (e.g. a rectangular window's long and short
    sides), so no area filtering is applied here.

    Real, confirmed-necessary negative check (the SAME false positive
    detect_polygon_rings' own investigation found, recurring here through a
    different path): a PLAIN BOX's own 4 side walls are ALSO
    axis-perpendicular, form a real degree-2 ring, AND trivially span the
    part's own full height (they ARE the part). Rejected with the same
    _is_parts_own_envelope check detect_polygon_rings uses.

    Returns list of {face_indices, side_count, area_mm2, centroid, bbox}.
    """
    from OCC.Core.BRepGProp import brepgprop  # type: ignore
    from OCC.Core.GProp import GProp_GProps  # type: ignore
    from OCC.Core.BRepBndLib import brepbndlib  # type: ignore
    from OCC.Core.Bnd import Bnd_Box  # type: ignore
    from .machining_feature_recognizer import _axis_span  # type: ignore

    faces, surface_type, plane_eq, raw_adjacency = _build_face_graph(shape, claimed_face_ids)

    ax, ay, az = datum_axis
    axis_norm = (ax * ax + ay * ay + az * az) ** 0.5 or 1.0
    ax, ay, az = ax / axis_norm, ay / axis_norm, az / axis_norm

    wall_nodes: Set[int] = set()
    for i, t in surface_type.items():
        if t != "PlanarFace":
            continue
        (nx, ny, nz), _offset = plane_eq[i]
        if abs(nx * ax + ny * ay + nz * az) < _WALL_AXIS_DOT_TOL:
            wall_nodes.add(i)

    if len(wall_nodes) < 3:
        return []

    graph: Dict[int, Set[int]] = {
        i: {n for n in raw_adjacency.get(i, ()) if n in wall_nodes} for i in wall_nodes
    }

    # Real 2-core pruning, same technique as detect_polygon_rings.
    remaining = set(wall_nodes)
    changed = True
    while changed:
        changed = False
        for node in list(remaining):
            if len(graph[node] & remaining) < 2:
                remaining.discard(node)
                changed = True

    if not remaining:
        return []

    part_span = _axis_span(part_bbox, (ax, ay, az)) if part_bbox is not None else None

    visited: Set[int] = set()
    cutouts: List[Dict] = []
    for start in remaining:
        if start in visited:
            continue
        stack = [start]
        component: List[int] = []
        visited.add(start)
        while stack:
            cur = stack.pop()
            component.append(cur)
            for nb in graph[cur] & remaining:
                if nb not in visited:
                    visited.add(nb)
                    stack.append(nb)

        if not (3 <= len(component) <= 12):
            continue

        component_set = set(component)
        if not all(len(graph[n] & component_set) == 2 for n in component):
            continue

        total_area = 0.0
        wx = wy = wz = 0.0
        bnd = Bnd_Box()
        for fi in component:
            props = GProp_GProps()
            brepgprop.SurfaceProperties(faces[fi], props)
            area = props.Mass()
            cg = props.CentreOfMass()
            total_area += area
            wx += cg.X() * area
            wy += cg.Y() * area
            wz += cg.Z() * area
            brepbndlib.Add(faces[fi], bnd)
        if total_area <= 0:
            continue
        xmin, ymin, zmin, xmax, ymax, zmax = bnd.Get()

        if part_bbox is not None and _is_parts_own_envelope(
            (xmin, ymin, zmin, xmax, ymax, zmax), part_bbox
        ):
            continue

        if part_span is not None and part_span > 0:
            ring_span = _axis_span(
                {"xmin": xmin, "ymin": ymin, "zmin": zmin, "xmax": xmax, "ymax": ymax, "zmax": zmax},
                (ax, ay, az),
            )
            if (ring_span / part_span) <= _CUTOUT_THROUGH_SPAN_RATIO:
                # Doesn't reach through the full part thickness -- a real
                # blind pocket/socket, not a real cutout. Left unclaimed;
                # Phase 3 picks these walls up as ordinary planar_face
                # regions, the same honest fallback as every other
                # rejected candidate here.
                continue

        cutouts.append({
            "face_indices": sorted(component),
            "side_count": len(component),
            "area_mm2": round(total_area, 3),
            "centroid": (
                round(wx / total_area, 3),
                round(wy / total_area, 3),
                round(wz / total_area, 3),
            ),
            "bbox": {
                "xmin": round(xmin, 3), "ymin": round(ymin, 3), "zmin": round(zmin, 3),
                "xmax": round(xmax, 3), "ymax": round(ymax, 3), "zmax": round(zmax, 3),
            },
        })

    return cutouts
