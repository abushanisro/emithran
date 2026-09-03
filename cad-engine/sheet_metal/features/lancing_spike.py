"""
Lance (partial-cut, material-remains-attached, displaced flap) FEASIBILITY
SPIKE. Same discipline as forming_spike.py and bend_relationships.py: this
answers whether the underlying OCC kernel can find CANDIDATE lance
geometry, not "here is a production lance detector". NOT called from
SheetMetalFeatureExtractor.extract().

Key geometric insight (the reason this spike is worth attempting at all,
unlike a from-scratch technique): a lance's HINGE -- the one edge where the
flap stays continuous with the surrounding sheet -- is topologically a real
BEND (a cylindrical fold-radius face), just a very SHORT one, spanning only
the flap's own width instead of a whole panel's width. This codebase
already has a proven, tested bend-cylinder classifier
(SheetMetalFeatureExtractor._is_bend_cylinder) and a proven edge/face
adjacency walker (bend_relationships.py's _build_edge_face_adjacency) --
this spike reuses both rather than inventing new topology primitives.

Approach: take the bend candidates _is_bend_cylinder already finds, and ask
whether a SHORT one (much shorter than the panel it's on) whose far-side
connected face is a SMALL, roughly flap-sized island -- rather than a large
panel continuing further -- is a plausible lance-hinge candidate.

HONEST LIMITATION (mirrors forming_spike.py's own): this signature --
"short bend, small far-side flange" -- cannot be distinguished from an
ordinary SMALL SECONDARY BENT TAB (e.g. a small mounting ear bent up at 90
degrees) that happens to be a similar size. Both produce the identical
short-bend + small-flange fact pattern; nothing in this pipeline's B-Rep
data distinguishes "this flap is a lance, cut on 3 sides from the same
parent sheet" from "this is a genuinely separate small bent panel". Every
candidate therefore carries recognition_status='ambiguous'.

FIXTURE LIMITATION (disclosed, not hidden): a real fused/tilted lance solid
(base plate with a 3-sided slot plus a separately-built, rotated flap solid
sharing a true coincident hinge edge, joined via BRepAlgoAPI_Fuse) was not
attempted in this pass -- constructing a guaranteed-manifold fused solid of
that shape is itself nontrivial OCC boolean-operation work, independent of
whether the classification LOGIC below is sound. This spike is therefore
verified against synthetic (dict-level) geometric facts only, in the same
shape a real caller would assemble from _is_bend_cylinder's tuples and
bend_relationships.py's adjacency -- NOT against a real cut-and-bent B-Rep
solid. That real-geometry verification remains open.
"""

from typing import Any, Dict, List, Optional

# NOT sourced (sm_reference_data has zero rows for "lanc" -- see this
# session's investigation). A real full-panel bend spans close to the
# panel's own width; a lance hinge spans only its own small flap -- this
# ceiling is this spike's own choice for "short enough to be a flap, not a
# panel edge", deliberately conservative (high) so it would not exclude a
# real lance, at the cost of also admitting some ordinary small tabs (see
# module docstring's honest limitation).
MAX_HINGE_LENGTH_TO_PANEL_WIDTH_RATIO = 0.35

# NOT sourced. A lance flap's far-side area should be roughly proportional
# to its hinge length squared (a small, roughly flap-shaped island), not a
# large multiple of it (which would indicate a genuine continuing panel,
# not a small tab). Generous on purpose -- see module docstring.
MAX_FLANGE_AREA_TO_HINGE_LENGTH_SQUARED_RATIO = 8.0


def _classify_candidates(
    bend_candidates: List[Dict[str, Any]],
    panel_min_dim_mm: float,
) -> List[Dict[str, Any]]:
    """
    Pure filtering core (no OCC access).

    bend_candidates: one dict per real bend already found by
    _is_bend_cylinder (i.e. an ALREADY-PROVEN bend, not re-derived here):
      {axial_length_mm, flange_area_mm2, centroid_mm, face_ids}
    flange_area_mm2 is the area of the SMALLEST real planar neighbor face
    connected to this bend's far side (the candidate flap itself) -- the
    same "wall_neighbors" adjacency technique bend_relationships.py already
    uses, just reporting area instead of a relationship fact.

    panel_min_dim_mm: the panel this bend sits on's own shorter bbox
    dimension -- the real-vs-noise scale reference (same role
    bend_relationships.py's sheet_width_mm plays for its own threshold).

    Returns one dict per candidate: {hinge_length_mm, flange_area_mm2,
    centroid_mm, face_ids, recognition_status: 'ambiguous'} -- never
    'recognized'; see module docstring for why.
    """
    if panel_min_dim_mm <= 0:
        return []

    candidates: List[Dict[str, Any]] = []
    for b in bend_candidates:
        hinge_length = b.get("axial_length_mm", 0.0)
        flange_area = b.get("flange_area_mm2")
        if hinge_length <= 0 or flange_area is None:
            continue
        if hinge_length > panel_min_dim_mm * MAX_HINGE_LENGTH_TO_PANEL_WIDTH_RATIO:
            continue  # spans too much of the panel -- a real full bend, not a flap hinge
        if flange_area > MAX_FLANGE_AREA_TO_HINGE_LENGTH_SQUARED_RATIO * (hinge_length ** 2):
            continue  # far side is too large to be a small flap -- a real continuing panel

        candidates.append({
            "feature_type": "candidate_lance",
            "hinge_length_mm": round(hinge_length, 2),
            "flange_area_mm2": round(flange_area, 2),
            "centroid_mm": list(b.get("centroid_mm", [0.0, 0.0, 0.0])),
            "face_ids": list(b.get("face_ids", [])),
            "recognition_status": "ambiguous",
        })

    return candidates


def detect_candidate_lances(
    shape: Any,
    dominant_normal: Any,
    sheet_thickness: float,
    panels: List[Dict[str, Any]],
    panel_min_dim_mm: float,
    raw_cylinders_full: List[Any],
) -> List[Dict[str, Any]]:
    """
    Real-OCC entry point. Reuses
    SheetMetalFeatureExtractor._is_bend_cylinder (via the caller -- see
    below) to find real bend candidates, and bend_relationships.py's
    _build_edge_face_adjacency to find each candidate's real far-side
    flange face and area, then applies _classify_candidates' filtering.

    This function is intentionally NOT a SheetMetalFeatureExtractor method
    -- it takes bend_cylinder classification as an INPUT (raw_cylinders_full
    plus the caller's own _is_bend_cylinder pass) rather than duplicating
    that logic, exactly as this module's docstring requires.
    """
    from sheet_metal.bend_relationships import _build_edge_face_adjacency, _face_area_mm2

    max_bend_r = max(sheet_thickness * 8, 20.0) if sheet_thickness > 0 else 20.0
    # Import locally to avoid a hard import-time dependency for callers that
    # only need _classify_candidates (e.g. tests).
    from sheet_metal.feature_extractor import SheetMetalFeatureExtractor

    extractor = SheetMetalFeatureExtractor()
    bend_entries = [
        c for c in raw_cylinders_full
        if extractor._is_bend_cylinder(c, sheet_thickness, max_bend_r, dominant_normal)
    ]
    if not bend_entries:
        return []

    faces, adjacency = _build_edge_face_adjacency(shape)
    face_area = {i: _face_area_mm2(f) for i, f in enumerate(faces)}

    bend_candidates: List[Dict[str, Any]] = []
    for c in bend_entries:
        face_idx = int(c[8])
        neighbor_ids = adjacency.get(face_idx, set())
        flange_area = min((face_area.get(n, 0.0) for n in neighbor_ids), default=None)
        bend_candidates.append({
            "axial_length_mm": c[9] if len(c) > 9 else 0.0,
            "flange_area_mm2": flange_area,
            "centroid_mm": [c[2], c[3], c[4]],
            "face_ids": [face_idx],
        })

    return _classify_candidates(bend_candidates, panel_min_dim_mm)
