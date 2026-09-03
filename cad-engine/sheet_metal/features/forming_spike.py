"""
Formed-feature (emboss/dimple/louver/boss) FEASIBILITY SPIKE.

Built and self-labeled the same way bend_relationships.py was for
bend-to-bend relationships: this answers "can the underlying OCC kernel
find CANDIDATE formed-feature geometry at all", not "here is a production
dimple detector". It is NOT called from SheetMetalFeatureExtractor.extract()
and MUST NOT be wired in until its own honest limitation below is resolved
or explicitly accepted.

Investigated approach: a real formed dimple/boss/louver is a PAIRED offset
surface (inner + outer wall separated by sheet_thickness, closed into a
local cap) -- the same structural pattern this codebase already uses for
bends (_is_bend_cylinder) and panels (_identify_panels), just applied to
curved surfaces instead of planar ones. No detector for that pairing exists
anywhere in this codebase, and building one from scratch (with no fixtures
or prior art to validate against) is real, unproven work -- not a "reuse
existing primitive" task the way Perforating turned out to be.

What THIS spike does instead: reuses machining/cnc_feature_recognizer.py's
already-proven _collect_cylinders() blind_hole classification (the exact
same call sheet_metal/feature_extractor.py's _detect_counterbore_countersink
already makes) and asks whether a thickness-relative depth filter can
usefully narrow "every blind cylindrical cavity on the part" down to
"plausible formed-feature candidates".

HONEST FINDING (see test_forming_spike.py's
test_shallow_blind_hole_is_geometrically_identical_to_a_dimple_candidate):
this approach CANNOT distinguish a genuine formed dimple from an ordinary
shallow blind hole (e.g. an undersized tapped-hole pilot bore) purely from
B-Rep topology -- both are, geometrically, "a blind cylindrical cavity at a
thickness-relative depth, not touching the panel edge, not already claimed
by counterbore/countersink". Every candidate this spike returns therefore
carries recognition_status='ambiguous', never 'recognized' -- there is no
confident case, only a real, honestly-bounded candidate set. Reliable
discrimination would need a signal this pipeline does not have today (a
drawing callout, or confirmation of a genuine paired offset-wall structure
distinguishing "material displaced" from "material removed").

Scope: cylindrical blind cavities only. Conical candidates (louvers/vents
with a flared profile) are NOT covered -- machining/cnc_feature_recognizer's
_collect_cones() does not report a depth/length field, so the same
thickness-relative depth filter isn't directly available for cones without
additional geometry work not attempted in this spike.

SECOND, SHARPER FINDING (discovered fixing an initial depth-bound bug --
see MAX_DEPTH_THICKNESS_MULTIPLE's own comment): a 'blind_hole'-classified
cylinder cannot physically be deeper than the local material thickness
without becoming a through-hole, so this technique only reaches SHALLOW,
same-layer cavities. A genuine formed dimple/boss -- the more common real
case, and usually deeper than the sheet thickness -- is a paired offset-wall
structure that does not present as a simple blind_hole at all, and is
therefore fundamentally out of reach of this technique, not just
ambiguously classified by it. Combined with the first finding above, this
spike's conclusion is: candidate discovery works for a narrow shallow-cavity
subset, but even within that subset the result is never confidently a
dimple rather than an ordinary shallow blind hole -- and the broader,
deeper class of real formed features needs the different (unbuilt) paired
offset-wall technique described above, not an extension of this one.
"""

import math
from typing import Any, Dict, List, Optional, Tuple

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
    machining/cnc_feature_recognizer._collect_cylinders already returns
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
    Real-OCC entry point. Reuses CNCFeatureRecognizer._collect_cylinders
    (the exact same call sheet_metal/feature_extractor.py's
    _detect_counterbore_countersink already makes) to get real blind-cavity
    geometry, then applies _classify_candidates' filtering. See module
    docstring for the honest scope/limitation this spike established.
    """
    from machining.cnc_feature_recognizer import CNCFeatureRecognizer  # type: ignore
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

    recognizer = CNCFeatureRecognizer()
    bbox = {
        "xmin": bbox_minmax.get("xmin", 0.0), "xmax": bbox_minmax.get("xmax", 0.0),
        "ymin": bbox_minmax.get("ymin", 0.0), "ymax": bbox_minmax.get("ymax", 0.0),
        "zmin": bbox_minmax.get("zmin", 0.0), "zmax": bbox_minmax.get("zmax", 0.0),
    }
    cylinders = recognizer._collect_cylinders(shape, main_axis, bbox)
    return _classify_candidates(cylinders, sheet_thickness, bbox_minmax, known_hole_centroids_mm)
