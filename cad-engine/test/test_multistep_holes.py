"""
Real-OCC regression tests for Phase 5 of the machining feature-extraction
plan: multi-step hole detection (_detect_multistep_holes), a real
generalization of the existing 2-bore _detect_counterbores to chains of 3+
real coaxial bores of strictly decreasing diameter ("Multistep Holemaking" /
"Step Drilling" — 72 real rows in
memory/machining/operations_full__operations.csv, spanning both turned and
milled machine classes).

Disclosed, pre-existing, tangential finding surfaced while verifying the
milled-path fixture (NOT introduced by this detector, not fixed here): each
real flat annular "step shoulder" face (where one bore's diameter steps down
to the next) is picked up by the existing, unrelated _classify_prismatic
heuristic as its own small "pocket" candidate. Since these shoulder faces
have zero real out-of-plane thickness, their own pocket material_removed_mm3
computes to a real, honest 0.0 — but operation-sequencer.ts's "Pocket Finish
Floor"/"Pocket Finish Wall" cases add flat per-occurrence time regardless of
removed volume, so a real multi-step hole can currently also contribute a
handful of small, duplicate "Pocket Finish" seconds alongside its own real
Drill time. A real, small, pre-existing double-count risk — not attempted
here (fixing it needs face-exclusion plumbing into _classify_prismatic,
the same kind of change already disclosed as out of scope in
test_face_classification.py).
"""
from OCC.Core.BRepPrimAPI import BRepPrimAPI_MakeBox, BRepPrimAPI_MakeCylinder
from OCC.Core.BRepAlgoAPI import BRepAlgoAPI_Fuse, BRepAlgoAPI_Cut
from OCC.Core.gp import gp_Pnt, gp_Dir, gp_Ax2

from machining.machining_feature_recognizer import (
    MachiningFeatureRecognizer,
    build_machining_feature_graph_v2,
    _part_bounding_box,
)


def _recognize(shape, family):
    return MachiningFeatureRecognizer().recognize(shape, family)


def _by_type(tree, ftype):
    return [f for f in tree.features if f.type == ftype]


def _make_3step_tool(cx, cy, cz):
    ax1 = gp_Ax2(gp_Pnt(cx, cy, cz), gp_Dir(0, 0, -1))
    step1 = BRepPrimAPI_MakeCylinder(ax1, 8.0, 8.0).Shape()   # D=16, depth 8
    ax2 = gp_Ax2(gp_Pnt(cx, cy, cz), gp_Dir(0, 0, -1))
    step2 = BRepPrimAPI_MakeCylinder(ax2, 5.0, 18.0).Shape()  # D=10, total depth 18
    ax3 = gp_Ax2(gp_Pnt(cx, cy, cz), gp_Dir(0, 0, -1))
    step3 = BRepPrimAPI_MakeCylinder(ax3, 3.0, 28.0).Shape()  # D=6, total depth 28
    return BRepAlgoAPI_Fuse(BRepAlgoAPI_Fuse(step1, step2).Shape(), step3).Shape()


def _shaft_with_3step_hole():
    body = BRepPrimAPI_MakeCylinder(15.0, 40.0).Shape()
    return BRepAlgoAPI_Cut(body, _make_3step_tool(0, 0, 40.0)).Shape()


def _box_with_3step_hole():
    box = BRepPrimAPI_MakeBox(60.0, 50.0, 40.0).Shape()
    return BRepAlgoAPI_Cut(box, _make_3step_tool(30.0, 25.0, 40.0)).Shape()


def _shaft_with_ordinary_counterbore():
    """Negative control: a real 2-step (counterbore) hole must still be
    reported as 'counterbore', never absorbed as a 'multi_step_hole'."""
    body = BRepPrimAPI_MakeCylinder(15.0, 40.0).Shape()
    ax_wide = gp_Ax2(gp_Pnt(0, 0, 40.0), gp_Dir(0, 0, -1))
    wide = BRepPrimAPI_MakeCylinder(ax_wide, 8.0, 8.0).Shape()
    ax_narrow = gp_Ax2(gp_Pnt(0, 0, 40.0), gp_Dir(0, 0, -1))
    narrow = BRepPrimAPI_MakeCylinder(ax_narrow, 4.0, 20.0).Shape()
    tool = BRepAlgoAPI_Fuse(wide, narrow).Shape()
    return BRepAlgoAPI_Cut(body, tool).Shape()


def test_real_3step_hole_on_turned_part_yields_one_real_multistep_feature():
    tree = _recognize(_shaft_with_3step_hole(), "cnc_turned")
    holes = _by_type(tree, "multi_step_hole")
    assert len(holes) == 1
    h = holes[0]
    assert h.params["step_count"] == 3
    diams = [s["diameter_mm"] for s in h.params["steps"]]
    assert diams == [16.0, 10.0, 6.0]  # real, strictly decreasing, entry-to-bottom order
    assert len(h.face_ids) == 3

    # Real constituent bores must be absorbed, not double-counted.
    assert _by_type(tree, "through_hole") == []
    assert _by_type(tree, "blind_hole") == []
    assert _by_type(tree, "counterbore") == []


def test_real_3step_hole_on_milled_part_yields_one_real_multistep_feature():
    tree = _recognize(_box_with_3step_hole(), "cnc_milled")
    holes = _by_type(tree, "multi_step_hole")
    assert len(holes) == 1
    h = holes[0]
    diams = [s["diameter_mm"] for s in h.params["steps"]]
    assert diams == [16.0, 10.0, 6.0]
    assert len(h.face_ids) == 3
    assert _by_type(tree, "through_hole") == []
    assert _by_type(tree, "blind_hole") == []


def test_real_2step_hole_stays_a_counterbore_not_a_multistep_hole():
    tree = _recognize(_shaft_with_ordinary_counterbore(), "cnc_turned")
    assert len(_by_type(tree, "counterbore")) == 1
    assert _by_type(tree, "multi_step_hole") == []


def test_real_multistep_hole_survives_synthesis_with_real_removed_volume():
    shape = _shaft_with_3step_hole()
    tree = _recognize(shape, "cnc_turned")
    bbox = _part_bounding_box(shape)
    bbox_center = (
        (bbox["xmin"] + bbox["xmax"]) / 2,
        (bbox["ymin"] + bbox["ymax"]) / 2,
        (bbox["zmin"] + bbox["zmax"]) / 2,
    )
    fgv2 = build_machining_feature_graph_v2(tree.to_dict(), bbox_center, [], 0)

    entries = [f for f in fgv2["features"] if f["feature_type"] == "multi_step_hole"]
    assert len(entries) == 1
    occ = entries[0]["occurrences"][0]
    assert occ["step_count"] == 3
    assert len(occ["steps"]) == 3
    # Real, honest sum of each step's own cylindrical volume -- not zero,
    # not fabricated (see build_machining_feature_graph_v2's own doc comment
    # for this branch).
    assert occ["material_removed_mm3"] > 0
    assert occ["face_ids"]
