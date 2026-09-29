"""
Lance (partial cut, material remains attached, displaced flap) detection:
candidate discovery + a positive topological test. Emitted as
feature_graph_v2 "Lance" when recognized.

STAGE 1 -- CANDIDATE DISCOVERY (detect_candidate_lances)

A lance's HINGE -- the one edge where the flap stays continuous with the sheet
-- is topologically a real BEND (a cylindrical fold-radius face), just a SHORT
one spanning only the flap's width. Reuses the proven bend-cylinder classifier
(SheetMetalFeatureExtractor._is_bend_cylinder) and edge/face adjacency walker
(bend_relationships._build_edge_face_adjacency): a short bend whose far-side
face is a small flap-sized island (not a continuing panel) is a candidate.
Honest limit of this stage alone: "short bend + small far-side flange" is
identical for a lance and an ordinary small bent tab, so every candidate is
recognition_status='ambiguous'.

STAGE 2 -- THE POSITIVE TEST (detect_lances)

A genuine lance cuts a 3-sided slit into the INTERIOR of a base panel, so the
notch left behind is fully enclosed by the panel: a real INNER WIRE in the
base panel's face boundary, sharing an edge with the hinge face. An ordinary
bent tab sits on the panel's OUTER boundary instead. Wire index 0 = outer
boundary, later wires = holes (the convention _face_breakdown uses). Enclosed
-> 'recognized'; otherwise stays 'ambiguous'.

DISCLOSED VERIFICATION GAP: stage 2's topological primitive
(_bend_borders_inner_wire_of) is verified on real B-Rep in test_lance.py;
stage 1 is verified on dict-level geometric facts. A full end-to-end run
against a genuine fused, tilted lance solid was not attempted -- building a
guaranteed-manifold fused solid of that shape is nontrivial OCC boolean work.
"""

from typing import Any, Dict, List, Optional

from sheet_metal.bend_relationships import _build_edge_face_adjacency

# ── Stage 1: candidate discovery ─────────────────────────────────────────────

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
            # The base/parent-panel-side neighbor face id (the larger-area
            # real neighbor, opposite the flap) -- additive, forwarded only
            # when the real-OCC wrapper supplied it. _classify_candidates'
            # own filtering never reads it; sheet_metal/features/lance.py's
            # promotion test does.
            "base_face_id": b.get("base_face_id"),
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
        # The base/parent-panel side of this bend -- the LARGER-area real
        # neighbor, opposite the flap. Used only by lance.py's promotion
        # test (does the notch here sit inside the base panel's own
        # interior, or on its outer boundary); _classify_candidates' own
        # filtering never reads it.
        base_face_id = (
            max(neighbor_ids, key=lambda n: face_area.get(n, 0.0)) if neighbor_ids else None
        )
        bend_candidates.append({
            "axial_length_mm": c[9] if len(c) > 9 else 0.0,
            "flange_area_mm2": flange_area,
            "base_face_id": base_face_id,
            "centroid_mm": [c[2], c[3], c[4]],
            "face_ids": [face_idx],
        })

    return _classify_candidates(bend_candidates, panel_min_dim_mm)


# ── Stage 2: positive topological test ───────────────────────────────────────

def _bend_borders_inner_wire_of(base_face: Any, bend_face: Any) -> bool:
    """
    True if `bend_face` shares an edge with an INNER wire (a hole) of
    `base_face` — meaning the notch where the bend/hinge sits is fully
    enclosed within the base panel's interior, not open to its outer
    boundary. See module docstring for the full physical reasoning.
    """
    from OCC.Core.TopExp import TopExp_Explorer  # type: ignore
    from OCC.Core.TopAbs import TopAbs_WIRE, TopAbs_EDGE  # type: ignore
    from OCC.Core.TopoDS import topods  # type: ignore

    bend_edges = []
    be = TopExp_Explorer(bend_face, TopAbs_EDGE)
    while be.More():
        bend_edges.append(topods.Edge(be.Current()))
        be.Next()
    if not bend_edges:
        return False

    we = TopExp_Explorer(base_face, TopAbs_WIRE)
    wire_idx = 0
    while we.More():
        if wire_idx > 0:
            wire = topods.Wire(we.Current())
            ee = TopExp_Explorer(wire, TopAbs_EDGE)
            while ee.More():
                edge = topods.Edge(ee.Current())
                if any(edge.IsSame(be_) for be_ in bend_edges):
                    return True
                ee.Next()
        wire_idx += 1
        we.Next()
    return False


def detect_lances(
    shape: Any,
    dominant_normal: Any,
    sheet_thickness: float,
    panels: List[Dict[str, Any]],
    panel_min_dim_mm: float,
    raw_cylinders_full: List[Any],
) -> List[Dict[str, Any]]:
    """
    Real-OCC entry point. Reuses stage 1's candidate discovery
    unchanged, then promotes a candidate to 'recognized' when the base
    panel's own boundary encloses the hinge as a genuine interior hole —
    see `_bend_borders_inner_wire_of` and the module docstring for why that
    is real topological evidence, not a guess. A candidate with no
    resolvable base face, or whose base face's boundary is its OUTER wire at
    that location, stays 'ambiguous' — exactly stage 1's existing,
    honest result.
    """
    candidates = detect_candidate_lances(
        shape, dominant_normal, sheet_thickness, panels, panel_min_dim_mm, raw_cylinders_full,
    )
    if not candidates:
        return candidates

    faces, _adjacency = _build_edge_face_adjacency(shape)

    for c in candidates:
        base_face_id = c.get("base_face_id")
        bend_face_ids = c.get("face_ids") or []
        if base_face_id is None or not bend_face_ids:
            continue
        if base_face_id >= len(faces) or bend_face_ids[0] >= len(faces):
            continue
        base_face = faces[base_face_id]
        bend_face = faces[bend_face_ids[0]]
        try:
            if _bend_borders_inner_wire_of(base_face, bend_face):
                c["recognition_status"] = "recognized"
                c["recognition_evidence"] = (
                    "the base panel's own boundary encloses this hinge as an interior hole -- "
                    "a real 3-sided slit cut from the panel's interior, not an edge/corner tab"
                )
        except Exception:
            pass  # stays 'ambiguous' -- never guessed

    return candidates


def count_recognized(candidates: List[Dict[str, Any]]) -> int:
    """Confident detections only -- 'ambiguous' candidates are never counted."""
    return sum(1 for c in candidates if c.get("recognition_status") == "recognized")
