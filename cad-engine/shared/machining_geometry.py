"""
Shared, cross-domain machining geometry primitives — extracted from
machining/machining_feature_recognizer.py (2026-09-19, itself renamed the
same day from machining/cnc_feature_recognizer.py per the "Machining is the
canonical domain, not CNC" architecture mandate) per the machining
feature-extraction architecture plan's layer-separation requirement.

WHY THIS LIVES IN shared/, NOT machining/

sheet_metal/feature_extractor.py and sheet_metal/features/forming_spike.py
already depend directly on several of these primitives (confirmed by grep
before this file existed): hole-classification (_TAP_DRILL_RANGES,
classify_hole), cone classification (classify_cone), counterbore pairing
(detect_counterbores), and the raw cylinder collector (collect_cylinders,
previously reached via MachiningFeatureRecognizer._collect_cylinders — a
Machining-domain class internal a second domain had no real business
reaching into). This file is a real, live-used cross-domain geometry
library, not a Machining-exclusive implementation detail — the module
boundary now says so honestly.

WHAT THIS DELIBERATELY DOES NOT DEPEND ON

No import of machining.feature_models (MachiningFeature/MachiningFeatureTree/
MachiningFeatureType) or anything else Machining-specific — functions here
operate on plain dicts and duck-typed objects (attributes .id/.params/.face_ids),
so a caller from ANY domain can use them without pulling in
Machining-specific data structures. machining_feature_recognizer.py
re-exports every name here unchanged, and the deprecated
cnc_feature_recognizer.py compatibility shim re-exports them a second time,
so `from machining.cnc_feature_recognizer import _TAP_DRILL_RANGES`
(Sheet Metal's real existing import, pre-rename) keeps working without
modification.
"""
from __future__ import annotations

import math
from typing import Any, Dict, List, Optional, Tuple

# ── Tap drill size table ──────────────────────────────────────────────────────
# Maps (min_mm, max_mm) tap pre-drill range → thread spec.
# Tolerance is ±0.15 mm to handle STEP tessellation rounding.
# Helicoil pre-drills are ~10% larger than standard; those matches are tagged separately.
TAP_DRILL_RANGES: List[Tuple[float, float, str]] = [
    (1.45, 1.75, "M2×0.4"),
    (1.95, 2.20, "M2.5×0.45"),
    (2.40, 2.65, "M3×0.5"),
    (3.20, 3.50, "M4×0.7"),
    (4.10, 4.40, "M5×0.8"),
    (4.85, 5.20, "M6×1.0"),
    (6.60, 7.00, "M8×1.25"),
    (8.30, 8.70, "M10×1.5"),
    (10.10, 10.60, "M12×1.75"),
]
# Helicoil pre-drill diameters (nominally thread_OD × 1.10, ±0.15 mm)
HELICOIL_DRILL_RANGES: List[Tuple[float, float, str]] = [
    (2.15, 2.45, "M2×0.4"),
    (2.65, 2.95, "M2.5×0.45"),
    (3.25, 3.60, "M3×0.5"),
    (4.30, 4.65, "M4×0.7"),
    (5.40, 5.75, "M5×0.8"),
    (6.50, 6.90, "M6×1.0"),
    (8.70, 9.10, "M8×1.25"),
]

# Two bores are "coaxial" (same real axis line, different depths) when their
# real centroids sit within this distance -- shared by detect_counterbores
# and detect_multistep_holes so both use the exact same real tolerance.
MAX_COAXIAL_DIST_MM = 5.0


def classify_hole(diameter_mm: float, through: bool) -> Tuple[str, Optional[str], bool]:
    """
    Returns (feature_type, thread_spec_or_None, is_helicoil).

    Heuristic: holes whose diameter falls within a known tap pre-drill range are
    emitted as 'tapped_hole' (confidence 0.55 — geometry only, no PMI to confirm).
    Applies to BOTH blind and through holes: an M4×0.7 tapped-thru hole pre-drills
    at Ø3.3 exactly like a blind one. The old blind-only gate silently dropped
    every through-tapped hole, so drawing-less parts lost all thru-thread cost.

    Known limitation (through holes): tap-drill bands overlap clearance-drill
    sizes of the next thread size down (e.g. M5 tap drill Ø4.2 vs M4 close
    clearance Ø4.3–4.5 in the M5 helicoil band). Confidence stays 0.55 with
    detection='geometry_heuristic'; the backend treats 2D-drawing thread callouts
    as authoritative and only uses these candidates when no drawing exists.

    Helicoil variant flagged separately for the process planner.
    """
    for lo, hi, spec in TAP_DRILL_RANGES:
        if lo <= diameter_mm <= hi:
            return "tapped_hole", spec, False
    for lo, hi, spec in HELICOIL_DRILL_RANGES:
        if lo <= diameter_mm <= hi:
            return "tapped_hole", spec, True
    return ("through_hole" if through else "blind_hole"), None, False


def annotate_hole_depth(params: Dict, diameter_mm: float, depth_mm: float) -> None:
    """
    Depth-driven machinability annotations shared by all hole emit sites:
      ld_ratio  — depth / diameter
      deep_hole — L/D > 3: standard twist drilling needs peck cycles; > 5 needs
                  parabolic-flute or gun drilling. The process planner uses this
                  to adjust drilling cycle time and flag DFM risk.
    """
    if diameter_mm <= 0 or depth_mm <= 0:
        return
    ld = round(depth_mm / diameter_mm, 2)
    params["ld_ratio"] = ld
    if ld > 3.0:
        params["deep_hole"] = True


def classify_cone(cone: Dict, cylinders: List[Dict]) -> Tuple[str, Dict, float]:
    """
    A cone is a countersink if there is a coaxial cylinder immediately below it.
    Otherwise it is a chamfer.
    """
    cx, cy, cz = cone["centroid"]
    half_angle = cone["half_angle_deg"]
    ref_r = cone["ref_radius"]

    # Check for coaxial adjacent cylinder (within 5 mm centroid proximity)
    for cyl in cylinders:
        if cyl["kind"] in ("through_hole", "blind_hole"):
            dcx, dcy, dcz = cyl["centroid"]
            dist = math.sqrt((cx - dcx) ** 2 + (cy - dcy) ** 2 + (cz - dcz) ** 2)
            if dist < 5.0 and cyl["radius"] < ref_r:
                return "countersink", {
                    "entry_diameter_mm": round(ref_r * 2.0, 3),
                    "bore_diameter_mm": round(cyl["radius"] * 2.0, 3),
                    "half_angle_deg": round(half_angle, 1),
                    # centroid required by build_machining_feature_graph_v2 to
                    # place this feature -- the cone's own centroid, already
                    # computed above, was never actually propagated into the
                    # returned params before this fix.
                    "centroid": (round(cx, 3), round(cy, 3), round(cz, 3)),
                }, 0.78

    return "chamfer", {
        "half_angle_deg": round(half_angle, 1),
        "diameter_mm": round(ref_r * 2.0, 3),
        "centroid": (round(cx, 3), round(cy, 3), round(cz, 3)),
    }, 0.85


def detect_counterbores(
    bore_features: List[Any],
    bore_id_to_cyl: Optional[Dict[str, Dict]] = None,
) -> List[Tuple[str, str, Dict]]:
    """
    Identifies counterbore pairs: two coaxial bores where the outer is larger
    and shallower than the inner.

    bore_features: objects with .id/.params (duck-typed -- both machining's
    real MachiningFeature and Sheet Metal's own compatible construction work).

    Returns list of (outer_id, inner_id, params).
    """
    results = []
    checked: set = set()
    for i, outer in enumerate(bore_features):
        for j, inner in enumerate(bore_features):
            if i >= j:
                continue
            pair_key = (outer.id, inner.id)
            if pair_key in checked:
                continue
            checked.add(pair_key)
            od = outer.params["diameter_mm"]
            id_ = inner.params["diameter_mm"]
            if od <= id_:
                continue
            oc = None
            if bore_id_to_cyl:
                oc = bore_id_to_cyl.get(outer.id, {}).get("centroid")
                ic = bore_id_to_cyl.get(inner.id, {}).get("centroid")
                if oc and ic:
                    dist = math.sqrt(sum((a - b) ** 2 for a, b in zip(oc, ic)))
                    if dist > MAX_COAXIAL_DIST_MM:
                        continue
            outer_depth = outer.params["depth_mm"]
            inner_depth = inner.params["depth_mm"]
            if outer_depth >= inner_depth:
                continue
            params = {
                "counterbore_diameter_mm": od,
                "counterbore_depth_mm": round(outer_depth, 3),
                "bore_diameter_mm": id_,
                "bore_depth_mm": round(inner_depth, 3),
            }
            # centroid (the outer/visible bore's position -- where a tool
            # approaches from) is required by build_machining_feature_graph_v2
            # to place this feature; without bore_id_to_cyl there is no real
            # position data to report, so the feature is correctly omitted
            # downstream rather than placed at a fabricated location.
            if oc:
                params["centroid"] = oc
            results.append((outer.id, inner.id, params))
    return results


def detect_multistep_holes(
    bore_features: List[Any],
    bore_id_to_cyl: Optional[Dict[str, Dict]] = None,
) -> List[Tuple[List[str], Dict]]:
    """
    Identifies real multi-step hole chains: 3 or more coaxial bores of
    strictly decreasing diameter (step drilling / "Multistep Holemaking" —
    72 real rows in operations_full__operations.csv, spanning both turned
    and milled machine classes). A real generalization of
    detect_counterbores' 2-bore pairing -- exactly-2-bore chains stay
    counterbore's own job; this only claims chains of 3+, and callers must
    run this BEFORE detect_counterbores on the same bore list so a real
    3-step hole isn't ALSO reported as two overlapping 2-way counterbore
    pairs.

    Returns list of (member_ids_shallow_to_deep, params).
    """
    if not bore_id_to_cyl:
        return []

    # Real coaxial grouping: union bores whose centroids sit within the same
    # real tolerance detect_counterbores already uses for "same axis line".
    used: set = set()
    groups: List[List[Any]] = []
    for f in bore_features:
        if f.id in used:
            continue
        c0 = bore_id_to_cyl.get(f.id, {}).get("centroid")
        if not c0:
            continue
        group = [f]
        used.add(f.id)
        for g in bore_features:
            if g.id in used:
                continue
            cg = bore_id_to_cyl.get(g.id, {}).get("centroid")
            if not cg:
                continue
            dist = math.sqrt(sum((a - b) ** 2 for a, b in zip(c0, cg)))
            if dist <= MAX_COAXIAL_DIST_MM:
                group.append(g)
                used.add(g.id)
        if len(group) >= 3:
            groups.append(group)

    results = []
    for group in groups:
        # Diameter is the real, robust ordering signal here -- unlike
        # depth_mm (each bore's own EXPOSED face length, not its cumulative
        # position from the entry, per detect_counterbores' own real
        # observed behavior), diameter monotonically decreases from entry to
        # bottom by definition of a genuine step-drilled sequence.
        ordered = sorted(group, key=lambda f: f.params["diameter_mm"], reverse=True)
        diam_seq = [f.params["diameter_mm"] for f in ordered]
        if len(set(diam_seq)) != len(diam_seq):
            continue  # a real tie means this is not one genuine tapered sequence
        steps = [
            {"diameter_mm": f.params["diameter_mm"], "depth_mm": round(f.params.get("depth_mm", 0.0) or 0.0, 3)}
            for f in ordered
        ]
        face_ids = list(set(fid for f in ordered for fid in f.face_ids))
        centroid = bore_id_to_cyl.get(ordered[0].id, {}).get("centroid")
        params: Dict = {"steps": steps, "step_count": len(steps), "face_ids": face_ids}
        if centroid:
            params["centroid"] = centroid
        results.append(([f.id for f in ordered], params))
    return results


# ── Geometry utilities ────────────────────────────────────────────────────────


def point_to_axis_distance(
    point: Tuple[float, float, float],
    axis_unit: Tuple[float, float, float],
) -> float:
    """
    Distance from a point to a line through the origin with direction axis_unit.
    Works for arbitrary axis orientation via cross-product magnitude.
    """
    px, py, pz = point
    ax, ay, az = axis_unit
    # |P × axis| where P = point vector, axis = unit vector
    cx = py * az - pz * ay
    cy = pz * ax - px * az
    cz = px * ay - py * ax
    return math.sqrt(cx * cx + cy * cy + cz * cz)


def angle_around_axis(
    point: Tuple[float, float, float],
    axis_unit: Tuple[float, float, float],
) -> float:
    """
    Angular position (0–360°) of a point projected onto the plane perpendicular
    to axis_unit. Uses a fixed reference vector perpendicular to the axis.
    """
    px, py, pz = point
    ax, ay, az = axis_unit

    # Project point onto plane perpendicular to axis
    dot = px * ax + py * ay + pz * az
    rx = px - dot * ax
    ry = py - dot * ay
    rz = pz - dot * az

    if math.sqrt(rx * rx + ry * ry + rz * rz) < 1e-6:
        return 0.0

    # Build a stable reference vector perpendicular to axis
    if abs(ax) < 0.9:
        ref = (1.0, 0.0, 0.0)
    else:
        ref = (0.0, 1.0, 0.0)
    # Gram-Schmidt: remove axis component from ref
    d = ref[0] * ax + ref[1] * ay + ref[2] * az
    ux = ref[0] - d * ax
    uy = ref[1] - d * ay
    uz = ref[2] - d * az
    un = math.sqrt(ux * ux + uy * uy + uz * uz) or 1.0
    ux, uy, uz = ux / un, uy / un, uz / un

    # Perpendicular reference: v = axis × u
    vx = ay * uz - az * uy
    vy = az * ux - ax * uz
    vz = ax * uy - ay * ux

    cosine = rx * ux + ry * uy + rz * uz
    sine = rx * vx + ry * vy + rz * vz
    angle = math.degrees(math.atan2(sine, cosine))
    return angle % 360.0


def axis_range(bbox: Dict, axis_unit: Tuple[float, float, float]) -> Tuple[float, float]:
    """
    Returns (min, max) of the bounding box corners projected onto the given
    axis unit vector -- the real extreme positions, not just their span.
    """
    corners = [
        (bbox["xmin"], bbox["ymin"], bbox["zmin"]),
        (bbox["xmax"], bbox["ymin"], bbox["zmin"]),
        (bbox["xmin"], bbox["ymax"], bbox["zmin"]),
        (bbox["xmax"], bbox["ymax"], bbox["zmin"]),
        (bbox["xmin"], bbox["ymin"], bbox["zmax"]),
        (bbox["xmax"], bbox["ymin"], bbox["zmax"]),
        (bbox["xmin"], bbox["ymax"], bbox["zmax"]),
        (bbox["xmax"], bbox["ymax"], bbox["zmax"]),
    ]
    ax, ay, az = axis_unit
    projections = [x * ax + y * ay + z * az for x, y, z in corners]
    return min(projections), max(projections)


def axis_span(bbox: Dict, axis_unit: Tuple[float, float, float]) -> float:
    """
    Returns the extent of the bounding box projected onto the given axis unit vector.
    """
    lo, hi = axis_range(bbox, axis_unit)
    return hi - lo


def part_bounding_box(shape) -> Dict:
    from OCC.Core.BRepBndLib import brepbndlib  # type: ignore
    from OCC.Core.Bnd import Bnd_Box  # type: ignore

    bbox = Bnd_Box()
    brepbndlib.Add(shape, bbox)
    xmin, ymin, zmin, xmax, ymax, zmax = bbox.Get()
    return {
        "xmin": xmin, "ymin": ymin, "zmin": zmin,
        "xmax": xmax, "ymax": ymax, "zmax": zmax,
    }


def collect_cylinders(
    shape,
    main_axis: Tuple[float, float, float],
    bbox: Dict,
) -> List[Dict]:
    """
    Collects all cylindrical faces and classifies each as:
      external_diameter | through_hole | blind_hole | cross_hole

    Uses face orientation (FORWARD/REVERSED) for external vs internal.
    Uses axis alignment with main_axis for axial vs cross orientation.
    Uses length vs part span for through vs blind discrimination.

    Real, live cross-domain primitive: Sheet Metal
    (sheet_metal/feature_extractor.py, sheet_metal/features/forming_spike.py)
    reuses this exact function (previously reached as
    MachiningFeatureRecognizer._collect_cylinders, a Machining-class internal) for
    its own blind_hole classification -- see those modules' own doc
    comments.
    """
    from OCC.Core.GeomAbs import GeomAbs_Cylinder  # type: ignore
    from OCC.Core.BRepAdaptor import BRepAdaptor_Surface  # type: ignore
    from OCC.Core.TopExp import TopExp_Explorer  # type: ignore
    from OCC.Core.TopAbs import TopAbs_FACE, TopAbs_FORWARD  # type: ignore
    from OCC.Core.BRepBndLib import brepbndlib  # type: ignore
    from OCC.Core.Bnd import Bnd_Box  # type: ignore

    ax, ay, az = main_axis
    axis_norm = math.sqrt(ax * ax + ay * ay + az * az) or 1.0
    ax, ay, az = ax / axis_norm, ay / axis_norm, az / axis_norm

    # Part span along main axis — used for through vs blind discrimination
    part_span = axis_span(bbox, (ax, ay, az))

    results = []
    face_idx = 0
    exp = TopExp_Explorer(shape, TopAbs_FACE)
    while exp.More():
        face = exp.Current()
        surf = BRepAdaptor_Surface(face)
        if surf.GetType() == GeomAbs_Cylinder:
            cyl = surf.Cylinder()
            radius = cyl.Radius()
            loc = cyl.Location()
            d = cyl.Axis().Direction()

            # Normalize face axis
            fx, fy, fz = d.X(), d.Y(), d.Z()
            fn = math.sqrt(fx * fx + fy * fy + fz * fz) or 1.0
            fx, fy, fz = fx / fn, fy / fn, fz / fn

            # Alignment with main axis (1.0 = parallel, 0.0 = perpendicular)
            alignment = abs(fx * ax + fy * ay + fz * az)

            # Centroid of cylinder base along main axis
            cx, cy, cz = loc.X(), loc.Y(), loc.Z()
            position = cx * ax + cy * ay + cz * az

            # Distance from centroid to main axis (arbitrary orientation)
            dist_from_axis = point_to_axis_distance((cx, cy, cz), (ax, ay, az))

            # Approximate length from face bounding box
            fbox = Bnd_Box()
            brepbndlib.Add(face, fbox)
            xmin, ymin, zmin, xmax, ymax, zmax = fbox.Get()
            face_span = axis_span(
                {"xmin": xmin, "ymin": ymin, "zmin": zmin,
                 "xmax": xmax, "ymax": ymax, "zmax": zmax},
                (fx, fy, fz),
            )
            length = max(face_span, 0.1)

            is_reversed = face.Orientation() != TopAbs_FORWARD

            # Angular position of centroid around main axis (for PCD grouping)
            angle_deg = angle_around_axis((cx, cy, cz), (ax, ay, az))

            if alignment >= 0.85:
                # Axially aligned cylinder
                if is_reversed:
                    # Inner surface → bore. Through vs blind from length/span ratio.
                    if part_span > 0 and (length / part_span) > 0.90:
                        kind = "through_hole"
                    else:
                        kind = "blind_hole"
                else:
                    kind = "external_diameter"
            else:
                kind = "cross_hole"

            # Arc extent in the U (angular) direction — 2π = full cylinder.
            # Used by _deduplicate_cylinders to distinguish arc patches of
            # one bore (each ~π/2, total ≈ 2π) from separate holes
            # (each ≈ 2π, total >> 2π).
            u_range = abs(surf.LastUParameter() - surf.FirstUParameter())

            results.append({
                "radius": radius,
                "length": length,
                "position": position,
                "kind": kind,
                "axis": (fx, fy, fz),
                "centroid": (cx, cy, cz),
                "dist_from_axis": dist_from_axis,
                "angle_deg": angle_deg,
                "u_range": u_range,
                "face_indices": [face_idx],  # OCC face ordinal — matches face_map in memory_optimizer
            })
        face_idx += 1  # increment for EVERY face, not just cylinders
        exp.Next()

    return results
