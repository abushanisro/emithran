"""
Formed-feature (dimple/emboss) detection: candidate discovery + a positive
topological test. Emitted as feature_graph_v2 "Form"/"emboss" when recognized.

STAGE 1 -- CANDIDATE DISCOVERY (detect_candidate_formed_features)

Reuses machining/machining_feature_recognizer.py's proven _collect_cylinders()
blind_hole classification and narrows "every blind cylindrical cavity" to
plausible formed-feature candidates with a thickness-relative depth filter,
edge margin and known-hole proximity exclusion. Two honest limits of this
stage alone:
  - It cannot distinguish a genuine formed dimple from an ordinary shallow
    blind hole (e.g. an undersized tapped-hole pilot bore): both are "a blind
    cylindrical cavity at a thickness-relative depth". Every candidate it
    returns is therefore recognition_status='ambiguous'.
  - A 'blind_hole'-classified cylinder cannot be deeper than the local
    material without becoming a through-hole, so only SHALLOW same-layer
    cavities (0.2-0.9x thickness) are reachable. A deep paired-offset
    dimple/boss does not present as a blind cylinder at all and is out of
    reach of this technique. Cones (louvers) are not covered either.

STAGE 2 -- THE POSITIVE TEST (detect_formed_features)

A blind hole (material REMOVED) leaves the sheet's OPPOSITE face untouched. A
genuine dimple/emboss (material DISPLACED by a punch) moves material on BOTH
faces: the back planar face (antiparallel to `dominant_face`, ~sheet_thickness
away -- the same pairing _identify_panels performs) has its own local void, an
INNER WIRE in its face boundary, at the candidate's XY footprint. Present ->
'recognized'. Absent -> stays 'ambiguous'. Purely topological, no guessed
threshold.

SOURCED CLASSIFICATION, NOT A RECOGNITION GATE

A recognized candidate's depth is described against real reference-data
multipliers (memory/sheetmetal/sheet_metal_variables.json), never used to
decide recognition:
  - shallowEmbossDepthMultiplier = 1 -> `is_shallow` at depth <= 1x thickness
  - deepDimpleMultiplier         = 4 -> `exceeds_typical_dimple_depth` at
    depth > 4x thickness (inert today: stage 1 tops out at 0.9x thickness).
"""

import math
from typing import Any, Dict, List, Optional, Tuple

# ── Stage 1: candidate discovery ─────────────────────────────────────────────

# NOT sourced from sm_reference_data directly (that data classifies an
# ALREADY-FOUND feature as shallow/deep -- see this module's own docstring
# and the perforation.py precedent for the same distinction).
#
# IMPORTANT PHYSICAL CONSTRAINT (corrected after an initial, wrong 6x-
# thickness upper bound): a "blind_hole"-classified cylinder, by
# construction, is a SINGLE cylindrical bore surface cut straight into one
# face of the local material -- it cannot be deeper than the local material
# thickness itself without breaking through to the other side (at which
# point _collect_cylinders' own length/part_span > 0.90 rule reclassifies
# it as 'through_hole'). A genuine FORMED dimple/boss, by contrast, is
# usually a PAIRED offset-wall structure (inner + outer surface, material
# displaced not removed) and can legitimately be deeper than the sheet
# thickness -- but that shape does NOT present as a simple 'blind_hole' to
# _collect_cylinders at all, so this spike's technique cannot reach it
# regardless of the depth bound chosen. The bounds below therefore only
# admit SHALLOW, same-layer blind cavities -- seemingly a narrower target
# than "dimples" in general (see this module's docstring for the resulting
# honest conclusion).
MIN_DEPTH_THICKNESS_MULTIPLE = 0.2
MAX_DEPTH_THICKNESS_MULTIPLE = 0.9  # matches _collect_cylinders' own through/blind boundary

# NOT sourced. Candidate radius bounds -- reuses the SAME real range
# _count_holes_with_location's hole filter already uses (0.3-150mm), since
# a formed feature's footprint is physically the same order of magnitude as
# a hole's.
MIN_RADIUS_MM = 0.3
MAX_RADIUS_MM = 150.0

# NOT sourced. A v1, bounding-box-relative approximation for "not touching
# the panel's own outer edge" -- real wire-distance would be more precise
# (see _edge_clearance elsewhere in this codebase) but is not needed to
# answer this spike's feasibility question. Expressed relative to the
# candidate's own diameter (a feature within 1x its own radius of the part
# boundary is likely an edge notch/flange remnant, not a local formed
# feature).
EDGE_MARGIN_RADIUS_MULTIPLE = 2.0

# NOT sourced. A candidate within this many multiples of ITS OWN diameter
# from an already-known real hole centroid is treated as that hole's own
# counterbore/countersink/chamfer remnant, not an independent formed
# feature -- same spirit as extruded_flange_count's existing coarse
# counterbore/countersink correction (also not per-instance-matched).
HOLE_PROXIMITY_DIAMETER_MULTIPLE = 3.0


def _classify_candidates(
    cylinders: List[Dict[str, Any]],
    sheet_thickness: float,
    bbox_minmax: Dict[str, float],
    known_hole_centroids_mm: Optional[List[Tuple[float, float, float]]] = None,
) -> List[Dict[str, Any]]:
    """
    Pure filtering core (no OCC access) -- takes the SAME dict shape
    machining/machining_feature_recognizer._collect_cylinders already returns
    (radius, length, kind, centroid, face_indices, ...) and narrows it to
    the candidate set described in this module's docstring.

    Every returned candidate has recognition_status='ambiguous' -- see
    module docstring for why 'recognized' is never used here.
    """
    if sheet_thickness <= 0:
        return []
    known_hole_centroids_mm = known_hole_centroids_mm or []

    xmin, xmax = bbox_minmax.get("xmin", 0.0), bbox_minmax.get("xmax", 0.0)
    ymin, ymax = bbox_minmax.get("ymin", 0.0), bbox_minmax.get("ymax", 0.0)

    candidates: List[Dict[str, Any]] = []
    for cyl in cylinders:
        if cyl.get("kind") != "blind_hole":
            continue
        radius = cyl.get("radius", 0.0)
        depth = cyl.get("length", 0.0)
        if not (MIN_RADIUS_MM <= radius <= MAX_RADIUS_MM):
            continue
        if not (sheet_thickness * MIN_DEPTH_THICKNESS_MULTIPLE <= depth <= sheet_thickness * MAX_DEPTH_THICKNESS_MULTIPLE):
            continue

        cx, cy, cz = cyl.get("centroid", (0.0, 0.0, 0.0))

        edge_margin = radius * EDGE_MARGIN_RADIUS_MULTIPLE
        if (cx - xmin) < edge_margin or (xmax - cx) < edge_margin:
            continue
        if (cy - ymin) < edge_margin or (ymax - cy) < edge_margin:
            continue

        hole_proximity = radius * 2.0 * HOLE_PROXIMITY_DIAMETER_MULTIPLE
        too_close_to_known_hole = False
        for hx, hy, hz in known_hole_centroids_mm:
            d = math.sqrt((cx - hx) ** 2 + (cy - hy) ** 2 + (cz - hz) ** 2)
            if d <= hole_proximity:
                too_close_to_known_hole = True
                break
        if too_close_to_known_hole:
            continue

        candidates.append({
            "feature_type": "candidate_formed_feature",
            "geometry_type": "cylindrical_blind_cavity",
            "diameter_mm": round(radius * 2.0, 2),
            "depth_mm": round(depth, 2),
            "depth_to_thickness_ratio": round(depth / sheet_thickness, 2),
            "centroid_mm": [round(cx, 2), round(cy, 2), round(cz, 2)],
            "face_ids": list(cyl.get("face_indices", [])),
            "recognition_status": "ambiguous",
        })

    return candidates


def detect_candidate_formed_features(
    shape: Any,
    dominant_face: Any,
    bbox_minmax: Dict[str, float],
    sheet_thickness: float,
    known_hole_centroids_mm: Optional[List[Tuple[float, float, float]]] = None,
) -> List[Dict[str, Any]]:
    """
    Real-OCC entry point. Reuses MachiningFeatureRecognizer._collect_cylinders
    (the exact same call sheet_metal/feature_extractor.py's
    _detect_counterbore_countersink already makes) to get real blind-cavity
    geometry, then applies _classify_candidates' filtering. See module
    docstring for the honest scope/limitation this spike established.
    """
    from machining.machining_feature_recognizer import MachiningFeatureRecognizer  # type: ignore
    from OCC.Core.BRepAdaptor import BRepAdaptor_Surface  # type: ignore
    from OCC.Core.GeomAbs import GeomAbs_Plane  # type: ignore

    if dominant_face is None:
        return []
    adaptor = BRepAdaptor_Surface(dominant_face)
    if adaptor.GetType() != GeomAbs_Plane:
        return []
    n = adaptor.Plane().Axis().Direction()
    nx, ny, nz = float(n.X()), float(n.Y()), float(n.Z())
    mag = math.sqrt(nx * nx + ny * ny + nz * nz) or 1.0
    main_axis = (nx / mag, ny / mag, nz / mag)

    recognizer = MachiningFeatureRecognizer()
    bbox = {
        "xmin": bbox_minmax.get("xmin", 0.0), "xmax": bbox_minmax.get("xmax", 0.0),
        "ymin": bbox_minmax.get("ymin", 0.0), "ymax": bbox_minmax.get("ymax", 0.0),
        "zmin": bbox_minmax.get("zmin", 0.0), "zmax": bbox_minmax.get("zmax", 0.0),
    }
    cylinders = recognizer._collect_cylinders(shape, main_axis, bbox)
    return _classify_candidates(cylinders, sheet_thickness, bbox_minmax, known_hole_centroids_mm)


# ── Stage 2: positive topological test ───────────────────────────────────────

# Sourced from memory/sheetmetal/sheet_metal_variables.json (real licensed
# reference data). Classification labels only -- see module docstring.
SHALLOW_EMBOSS_DEPTH_MULTIPLE = 1.0
DEEP_DIMPLE_MAX_DEPTH_MULTIPLE = 4.0

# Same tolerance _identify_panels already uses to pair antiparallel planar
# faces ~sheet_thickness apart -- reused, not reinvented.
_PANEL_PAIR_TOL_ABSOLUTE_MM = 0.15
_PANEL_PAIR_TOL_THICKNESS_MULTIPLE = 0.15


def _find_back_face(shape: Any, dominant_face: Any, sheet_thickness_mm: float) -> Optional[Any]:
    """
    The planar face antiparallel to `dominant_face`, ~sheet_thickness_mm away
    -- the physical back of the SAME panel `dominant_face` is the front of.

    Exactly `_identify_panels`' own antiparallel-pair-at-thickness technique
    (same tolerance formula, same forward/reversed-orientation normal fix),
    scoped to just this one face's partner. Not a change to that shared
    function -- it deliberately keeps only ONE representative face per pair
    and discards the other, which is exactly the face object this module
    needs.
    """
    from OCC.Core.BRepAdaptor import BRepAdaptor_Surface  # type: ignore
    from OCC.Core.TopExp import TopExp_Explorer  # type: ignore
    from OCC.Core.TopAbs import TopAbs_FACE, TopAbs_FORWARD  # type: ignore
    from OCC.Core.GeomAbs import GeomAbs_Plane  # type: ignore
    from OCC.Core.TopoDS import topods  # type: ignore
    from OCC.Core.BRepGProp import brepgprop  # type: ignore
    from OCC.Core.GProp import GProp_GProps  # type: ignore

    if sheet_thickness_mm <= 0 or dominant_face is None:
        return None

    dom_adaptor = BRepAdaptor_Surface(dominant_face)
    if dom_adaptor.GetType() != GeomAbs_Plane:
        return None
    dom_plane = dom_adaptor.Plane()
    dn = dom_plane.Axis().Direction()
    dnx, dny, dnz = float(dn.X()), float(dn.Y()), float(dn.Z())
    if dominant_face.Orientation() != TopAbs_FORWARD:
        dnx, dny, dnz = -dnx, -dny, -dnz
    dloc = dom_plane.Location()
    d_dom = dnx * float(dloc.X()) + dny * float(dloc.Y()) + dnz * float(dloc.Z())

    tol = max(_PANEL_PAIR_TOL_ABSOLUTE_MM, sheet_thickness_mm * _PANEL_PAIR_TOL_THICKNESS_MULTIPLE)

    best_face, best_area = None, 0.0
    exp = TopExp_Explorer(shape, TopAbs_FACE)
    while exp.More():
        face = topods.Face(exp.Current())
        try:
            if not face.IsSame(dominant_face):
                adaptor = BRepAdaptor_Surface(face)
                if adaptor.GetType() == GeomAbs_Plane:
                    plane = adaptor.Plane()
                    n = plane.Axis().Direction()
                    nx, ny, nz = float(n.X()), float(n.Y()), float(n.Z())
                    if face.Orientation() != TopAbs_FORWARD:
                        nx, ny, nz = -nx, -ny, -nz
                    dot = dnx * nx + dny * ny + dnz * nz
                    if dot <= -0.92:
                        ploc = plane.Location()
                        d_j = nx * float(ploc.X()) + ny * float(ploc.Y()) + nz * float(ploc.Z())
                        if abs(abs(d_dom + d_j) - sheet_thickness_mm) <= tol:
                            props = GProp_GProps()
                            brepgprop.SurfaceProperties(face, props)
                            area = props.Mass()
                            if area > best_area:
                                best_area = area
                                best_face = face
        except Exception:
            pass
        exp.Next()
    return best_face


def _back_face_has_local_void(
    back_face: Any,
    candidate_centroid_mm: Tuple[float, float, float],
    candidate_radius_mm: float,
) -> bool:
    """
    True if `back_face`'s own boundary has an INNER wire (a hole in this face
    -- a different face occupies that spot) whose bounding box overlaps the
    candidate's own circular footprint.

    Wire index 0 = outer boundary, every wire after it = an inner wire (a
    hole) -- the exact convention `_face_breakdown` already uses in
    feature_extractor.py for the same face/wire enumeration, reused here
    rather than reinvented.

    The overlap test itself is literal circle-vs-bbox overlap (candidate
    radius + the void's own half-diagonal) -- not a tuned multiplier, just
    "do these two footprints occupy the same space".
    """
    from OCC.Core.TopExp import TopExp_Explorer  # type: ignore
    from OCC.Core.TopAbs import TopAbs_WIRE  # type: ignore
    from OCC.Core.TopoDS import topods  # type: ignore
    from OCC.Core.Bnd import Bnd_Box  # type: ignore
    from OCC.Core.BRepBndLib import brepbndlib  # type: ignore

    cx, cy, cz = candidate_centroid_mm
    we = TopExp_Explorer(back_face, TopAbs_WIRE)
    wire_idx = 0
    while we.More():
        if wire_idx > 0:
            try:
                wire = topods.Wire(we.Current())
                box = Bnd_Box()
                brepbndlib.Add(wire, box)
                xmin, ymin, zmin, xmax, ymax, zmax = box.Get()
                wx = (xmin + xmax) / 2.0
                wy = (ymin + ymax) / 2.0
                wz = (zmin + zmax) / 2.0
                half_diag = math.sqrt((xmax - xmin) ** 2 + (ymax - ymin) ** 2 + (zmax - zmin) ** 2) / 2.0
                dist = math.sqrt((wx - cx) ** 2 + (wy - cy) ** 2 + (wz - cz) ** 2)
                if dist <= candidate_radius_mm + half_diag:
                    return True
            except Exception:
                pass
        wire_idx += 1
        we.Next()
    return False


def detect_formed_features(
    shape: Any,
    dominant_face: Any,
    bbox_minmax: Dict[str, float],
    sheet_thickness_mm: float,
    known_hole_centroids_mm: Optional[List[Tuple[float, float, float]]] = None,
) -> List[Dict[str, Any]]:
    """
    Real-OCC entry point. Reuses stage 1's candidate discovery
    unchanged, then promotes a candidate to 'recognized' when the sheet's
    back face has its own local void at that candidate's footprint -- see
    module docstring for why that is real topological evidence, not a guess.

    A candidate stays 'ambiguous' (exactly stage 1's existing,
    honest result) when no back face can be found, or when the back face is
    flat and undisturbed at that location.
    """
    candidates = detect_candidate_formed_features(
        shape, dominant_face, bbox_minmax, sheet_thickness_mm, known_hole_centroids_mm,
    )
    if not candidates:
        return candidates

    back_face = _find_back_face(shape, dominant_face, sheet_thickness_mm)
    if back_face is None:
        return candidates

    for c in candidates:
        radius_mm = c["diameter_mm"] / 2.0
        if _back_face_has_local_void(back_face, tuple(c["centroid_mm"]), radius_mm):
            c["recognition_status"] = "recognized"
            c["recognition_evidence"] = (
                "the sheet's opposite face has its own local void at this footprint -- "
                "material was displaced on both faces (a real paired offset-wall "
                "structure), not merely removed from the front alone"
            )
            depth_to_t = c["depth_to_thickness_ratio"]
            c["is_shallow"] = depth_to_t <= SHALLOW_EMBOSS_DEPTH_MULTIPLE
            c["exceeds_typical_dimple_depth"] = depth_to_t > DEEP_DIMPLE_MAX_DEPTH_MULTIPLE

    return candidates


def count_recognized(candidates: List[Dict[str, Any]]) -> int:
    """Confident detections only -- 'ambiguous' candidates are never counted."""
    return sum(1 for c in candidates if c.get("recognition_status") == "recognized")
