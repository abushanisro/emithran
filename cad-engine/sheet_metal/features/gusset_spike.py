"""
Gusset-corner (candidate gusset vs. open relief) FEASIBILITY SPIKE. Same
discipline as forming_spike.py/lancing_spike.py: this answers whether the
underlying OCC kernel can find CANDIDATE gusset geometry, not "here is a
production gusset detector". NOT called from
SheetMetalFeatureExtractor.extract().

WHY this spike, unlike Restriking/Setting/Coining/Scoring (see this
session's investigation): those four are real, sourced as PROCESS toggles
applied to an ALREADY-DETECTED bend/hole/blank feature
(enableRestrikingStraightCurvedBends, enableCoiningFlangedHoles --
sm_reference_data 'variable' rows, migration 479) -- they select HOW MANY
press hits/which station finishes an existing Form/StraightBend/Hole, never
producing distinct final-part geometry a CAD detector could find. Gusset is
different: defaultGussetStrategy ("During Bend" / other options) and
gussetBendComp1/gussetBendComp2 ("compensation dial for adjusting up the
cost of a gusset punch over a bend punch" / "...quantity of a gusset punch
vs. a bend punch", same migration) describe a real, distinct MATERIAL
decision at a bend CORNER -- close the corner with formed material (a
gusset) vs. leave it open (a relief cut/notch), a physically different final
shape either way. This is genuinely a different, real, sourced case from the
other four -- not re-litigating an already-closed finding.

Key geometric insight: a gusset sits at a CORNER where two bend lines meet
at roughly 90 degrees (e.g. a 4-sided pan/box formed from one flat blank).
This codebase's bend_relationships.py already computes real bend-to-bend
relationships, but only for bends that share a flange wall IN LINE (the
existing wall_neighbors/shared-flange technique -- a hem, channel, or Z-bend
signature). A corner gusset is a DIFFERENT pairing: two bends whose axes are
roughly PERPENDICULAR (not sharing an in-line flange) whose nearest ends sit
close together in space. This spike reuses the same real per-cylinder tuple
fields _is_bend_cylinder's callers already have (axis direction at indices
5-7, centroid at 2-4, axial length at 9 -- see feature_extractor.py's
raw_cylinders_full docstring) and bend_relationships.py's proven
_build_edge_face_adjacency, rather than inventing new topology primitives.

Approach: (1) find CORNER CANDIDATES -- pairs of real bends whose axis
directions are close to perpendicular AND whose nearest real endpoints
(centroid +/- axis_dir * axial_length/2, real vector math) are close
together; (2) for each corner candidate, ask whether a real, small bridging
face (via face adjacency) actually connects the two bends' near-corner
walls. A CLOSED corner (a real small face found) is a plausible gusset
candidate. An OPEN corner (no bridging face -- a genuine gap in the solid)
is the honest, DECISIVE negative case: no gusset is present, full stop --
this one is NOT ambiguous, unlike every other candidate this spike or its
siblings produce, because "no face exists there" is a real fact, not an
interpretation.

HONEST LIMITATION on the CLOSED-corner (candidate) case, mirroring
forming_spike.py/lancing_spike.py: a real small bridging face at a
near-perpendicular bend corner cannot be distinguished from an ordinary
design chamfer/fillet/transition face placed there for an unrelated reason
(e.g. a cosmetic radius, or a separately-modeled small bracket wall that
happens to sit at that corner). Nothing in this pipeline's B-Rep data
distinguishes "this face is a formed gusset closing a bend corner" from
"this face is coincidentally at the same location". Every CLOSED-corner
candidate therefore carries recognition_status='ambiguous' -- only the
OPEN-corner (no bridging face) case is reported as a confident negative.

FIXTURE LIMITATION (disclosed, not hidden): verified against synthetic
(dict-level) geometric facts only, in the same shape a real caller would
assemble from raw_cylinders_full's tuples and
bend_relationships.py's adjacency -- NOT against a real formed-box-corner
B-Rep solid (constructing one, with and without a real fused gusset tab, is
itself nontrivial OCC boolean/fillet work). Real-B-Rep verification remains
open, same as forming_spike.py and lancing_spike.py.
"""

from typing import Any, Dict, List, Optional, Tuple

# NOT sourced (sm_reference_data has no explicit "corner angle tolerance"
# value for gusset detection -- only the cost/strategy dials cited in the
# module docstring). A real box/pan corner is 90 degrees; this ceiling on
# |axis_a . axis_b| allows real-world modeling tolerance around exact
# perpendicularity (0.35 ~= up to ~20.5 degrees off 90) without admitting
# bends that are clearly not a corner pair (e.g. parallel or near-parallel
# axes, which bend_relationships.py's own in-line case already covers).
MAX_CORNER_AXIS_DOT = 0.35

# NOT sourced. How close the two bends' nearest real endpoints must be to
# plausibly be the SAME physical corner, scaled by sheet thickness (the
# real-vs-noise scale reference every other spike in this series uses
# instead of an absolute mm constant). Generous on purpose -- see module
# docstring's honest limitation; a real corner's bend lines meet almost
# exactly, but real fillet/radius geometry at the corner can offset them by
# a few thickness-multiples.
MAX_CORNER_ENDPOINT_DISTANCE_TO_THICKNESS_RATIO = 6.0

# NOT sourced. A real gusset tab's bridging face should be small -- roughly
# thickness-scale squared -- not a large panel that happens to touch both
# bends for an unrelated reason.
MAX_BRIDGE_FACE_AREA_TO_THICKNESS_SQUARED_RATIO = 12.0


def _endpoints(centroid_mm: Tuple[float, float, float], axis_dir: Tuple[float, float, float], axial_length_mm: float) -> Tuple[Tuple[float, float, float], Tuple[float, float, float]]:
    half = axial_length_mm / 2.0
    p1 = tuple(centroid_mm[k] - axis_dir[k] * half for k in range(3))
    p2 = tuple(centroid_mm[k] + axis_dir[k] * half for k in range(3))
    return p1, p2  # type: ignore[return-value]


def _min_endpoint_distance(a: Dict[str, Any], b: Dict[str, Any]) -> float:
    a1, a2 = _endpoints(tuple(a["centroid_mm"]), tuple(a["axis_dir"]), a["axial_length_mm"])
    b1, b2 = _endpoints(tuple(b["centroid_mm"]), tuple(b["axis_dir"]), b["axial_length_mm"])
    best = None
    for p in (a1, a2):
        for q in (b1, b2):
            d = sum((p[k] - q[k]) ** 2 for k in range(3)) ** 0.5
            if best is None or d < best:
                best = d
    return best if best is not None else float("inf")


def _classify_candidates(
    bends: List[Dict[str, Any]],
    sheet_thickness_mm: float,
    bridging_face_area: Dict[Tuple[int, int], Optional[float]],
) -> List[Dict[str, Any]]:
    """
    Pure filtering core (no OCC access).

    bends: one dict per already-proven real bend (from _is_bend_cylinder),
    each with {axis_dir: (x,y,z) unit vector, centroid_mm: (x,y,z),
    axial_length_mm: float, face_ids: List[int]}.

    bridging_face_area: real face-area lookup, keyed by the SORTED pair of
    bend list-indices, supplied by the real-OCC entry point below (None when
    no real face bridges that pair -- the honest open-corner case).

    Returns one dict per corner PAIR that passes the perpendicularity +
    proximity gate: {feature_type: 'candidate_gusset_corner', bend_a_face_ids,
    bend_b_face_ids, axis_dot, endpoint_distance_mm, bridging_face_area_mm2,
    is_closed: bool, recognition_status}. is_closed=True ->
    recognition_status='ambiguous' (a real face was found, but cannot be
    told apart from an unrelated design face -- see module docstring).
    is_closed=False -> recognition_status='recognized' (a real, decisive
    negative: no material bridges this corner, so no gusset is present).
    """
    if sheet_thickness_mm <= 0:
        return []

    max_endpoint_distance = sheet_thickness_mm * MAX_CORNER_ENDPOINT_DISTANCE_TO_THICKNESS_RATIO
    max_bridge_area = MAX_BRIDGE_FACE_AREA_TO_THICKNESS_SQUARED_RATIO * (sheet_thickness_mm ** 2)

    candidates: List[Dict[str, Any]] = []
    for i in range(len(bends)):
        for j in range(i + 1, len(bends)):
            a, b = bends[i], bends[j]
            ax, bx = a.get("axis_dir"), b.get("axis_dir")
            if not ax or not bx:
                continue
            axis_dot = sum(ax[k] * bx[k] for k in range(3))
            if abs(axis_dot) > MAX_CORNER_AXIS_DOT:
                continue  # not roughly perpendicular -- not a corner pair

            endpoint_distance = _min_endpoint_distance(a, b)
            if endpoint_distance > max_endpoint_distance:
                continue  # ends aren't near the same corner

            area = bridging_face_area.get((i, j))
            if area is not None and area > max_bridge_area:
                continue  # bridging face far too large to be a small gusset tab -- unrelated panel

            is_closed = area is not None
            candidates.append({
                "feature_type": "candidate_gusset_corner",
                "bend_a_face_ids": list(a.get("face_ids", [])),
                "bend_b_face_ids": list(b.get("face_ids", [])),
                "axis_dot": round(axis_dot, 4),
                "endpoint_distance_mm": round(endpoint_distance, 2),
                "bridging_face_area_mm2": round(area, 2) if area is not None else None,
                "is_closed": is_closed,
                "recognition_status": "ambiguous" if is_closed else "recognized",
            })
    return candidates


def detect_candidate_gusset_corners(
    shape: Any,
    dominant_normal: Any,
    sheet_thickness: float,
    raw_cylinders_full: List[Any],
) -> List[Dict[str, Any]]:
    """
    Real-OCC entry point. Reuses SheetMetalFeatureExtractor._is_bend_cylinder
    (via the caller) to find real bend candidates and
    bend_relationships.py's _build_edge_face_adjacency to find each corner
    pair's real bridging face (if any), then applies _classify_candidates'
    filtering. Intentionally NOT a SheetMetalFeatureExtractor method, same
    convention as lancing_spike.detect_candidate_lances.
    """
    from sheet_metal.bend_relationships import _build_edge_face_adjacency, _face_area_mm2
    from sheet_metal.feature_extractor import SheetMetalFeatureExtractor

    max_bend_r = max(sheet_thickness * 8, 20.0) if sheet_thickness > 0 else 20.0
    extractor = SheetMetalFeatureExtractor()
    bend_entries = [
        c for c in raw_cylinders_full
        if extractor._is_bend_cylinder(c, sheet_thickness, max_bend_r, dominant_normal)
    ]
    if len(bend_entries) < 2:
        return []

    bends: List[Dict[str, Any]] = []
    for c in bend_entries:
        bends.append({
            "axis_dir": (c[5], c[6], c[7]),
            "centroid_mm": (c[2], c[3], c[4]),
            "axial_length_mm": c[9] if len(c) > 9 else 0.0,
            "face_ids": [int(c[8])],
        })

    faces, adjacency = _build_edge_face_adjacency(shape)
    face_area = {i: _face_area_mm2(f) for i, f in enumerate(faces)}

    bridging_face_area: Dict[Tuple[int, int], Optional[float]] = {}
    for i in range(len(bends)):
        for j in range(i + 1, len(bends)):
            fi = bends[i]["face_ids"][0]
            fj = bends[j]["face_ids"][0]
            shared = adjacency.get(fi, set()) & adjacency.get(fj, set())
            shared = {n for n in shared if n != fi and n != fj}
            bridging_face_area[(i, j)] = min((face_area.get(n, 0.0) for n in shared), default=None)

    return _classify_candidates(bends, sheet_thickness, bridging_face_area)
