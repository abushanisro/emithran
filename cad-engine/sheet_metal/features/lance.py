"""
Lance RECOGNITION — the positive test lancing_spike.py was missing.

WHY THIS EXISTS

lancing_spike.py's own honest finding: a genuine lance hinge and an ordinary
SEPARATE small bent tab (e.g. a small mounting ear bent up 90deg) produce the
IDENTICAL short-hinge + small-far-side-flange fact pattern — nothing in that
candidate's own data (hinge length, flange area) distinguishes "this flap was
cut on 3 sides from the same parent sheet" from "this is a genuinely separate
small panel".

THE SIGNAL, AND WHY IT IS REAL TOPOLOGY, NOT A GUESSED THRESHOLD

A genuine lance cuts a 3-sided slit into the INTERIOR of a base panel and
folds the resulting flap up along the remaining (4th, hinge) side. The notch
left behind is fully enclosed by the base panel's own material — a real
INNER WIRE (a hole) in the base panel's own face boundary, one edge of which
is shared with the bend/hinge face.

An ordinary separate small bent tab, by contrast, sits at the panel's own
outer edge or corner — its notch is part of the panel's OUTER boundary
instead, because the tab was always physically at the edge; nothing was cut
out of a continuous interior region to make room for it.

So the question this module answers is purely topological: does the base
panel's own wire structure enclose this hinge as an interior hole, or does it
sit on the panel's outer contour? Wire index 0 = outer boundary, every wire
after it = an inner wire (a hole) — the exact convention `_face_breakdown`
already uses in feature_extractor.py for the same face/wire enumeration,
reused here rather than reinvented.

WHAT THIS DELIBERATELY DOES NOT DO

It does not change lancing_spike.py's own candidate scope or filtering
(MAX_HINGE_LENGTH_TO_PANEL_WIDTH_RATIO, MAX_FLANGE_AREA_TO_HINGE_LENGTH_
SQUARED_RATIO) — this module only promotes a subset of its candidates from
'ambiguous' to 'recognized' when the base-panel-enclosure evidence is
present.

HONEST, DISCLOSED VERIFICATION GAP (same discipline lancing_spike.py's own
docstring already applies): the core topological test
(`_bend_borders_inner_wire_of`) is verified against real, constructed B-Rep
in test_lance.py (a genuine inner-wire-vs-outer-wire distinction on real
faces). Running the FULL `detect_lances` pipeline end-to-end against a
genuine fused, tilted lance solid (base plate + a separately-built, rotated
flap fused at one true coincident hinge edge) was not attempted — both
lancing_spike.py and gusset_spike.py's own docstrings already disclose that
constructing such a guaranteed-manifold fused solid is itself nontrivial OCC
boolean-operation work, independent of whether this module's classification
logic is sound. That end-to-end fixture verification remains open.
"""

from typing import Any, Dict, List

from sheet_metal.bend_relationships import _build_edge_face_adjacency
from sheet_metal.features.lancing_spike import detect_candidate_lances


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
    Real-OCC entry point. Reuses lancing_spike.py's candidate discovery
    unchanged, then promotes a candidate to 'recognized' when the base
    panel's own boundary encloses the hinge as a genuine interior hole —
    see `_bend_borders_inner_wire_of` and the module docstring for why that
    is real topological evidence, not a guess. A candidate with no
    resolvable base face, or whose base face's boundary is its OUTER wire at
    that location, stays 'ambiguous' — exactly lancing_spike.py's existing,
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
