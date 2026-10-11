"""
feature_graph_v2.measurements: the faces behind pierce_count, bend_line_length
and flat_pattern_area, from the full production extract() pipeline on real B-Rep.

  - plate with one hole: pierces = the hole wall + the initial pierce on the
    outer profile, accounting for pierce_count exactly
  - two-bend U-channel: bend_line_length is the sum of the bends' own lengths
    on the bend faces; the flat-pattern faces include every panel + the bends
"""
import pytest

pytest.importorskip("OCC")

from OCC.Core.BRepAlgoAPI import BRepAlgoAPI_Cut  # noqa: E402
from OCC.Core.BRepAdaptor import BRepAdaptor_Surface  # noqa: E402
from OCC.Core.BRepPrimAPI import BRepPrimAPI_MakeBox, BRepPrimAPI_MakeCylinder  # noqa: E402
from OCC.Core.GeomAbs import GeomAbs_Cylinder  # noqa: E402
from OCC.Core.gp import gp_Ax2, gp_Dir, gp_Pnt  # noqa: E402

from test_cut_profile_faces import _extract, _faces  # noqa: E402
from test_bend_relationships import make_bent_sheet  # noqa: E402


def test_plate_with_hole_pierces_reconcile():
    plate = BRepPrimAPI_MakeBox(100.0, 50.0, 2.0).Shape()
    hole = BRepPrimAPI_MakeCylinder(gp_Ax2(gp_Pnt(30.0, 25.0, -1.0), gp_Dir(0, 0, 1)), 5.0, 4.0).Shape()
    shape = BRepAlgoAPI_Cut(plate, hole).Shape()

    result, _ = _extract(shape)
    m = result["feature_graph_v2"]["measurements"]["pierce_count"]

    assert m["value"] == result["pierce_count"] == 2
    assert m["reconciles"] is True
    kinds = [o["kind"] for o in m["occurrences"]]
    assert sorted(kinds) == ["hole", "initial_pierce"]
    faces = _faces(shape)
    hole_occ = next(o for o in m["occurrences"] if o["kind"] == "hole")
    # the hole's cut wall only, not the plate faces beside it
    assert [BRepAdaptor_Surface(faces[i]).GetType() for i in hole_occ["face_ids"]] == [GeomAbs_Cylinder]


def test_u_channel_bend_lines_and_flat_area_faces():
    shape = make_bent_sheet(seg_lens=[30.0, 20.0, 30.0], angles_deg=[90.0, 90.0])
    result, raw_cylinders_full = _extract(shape)
    meas = result["feature_graph_v2"]["measurements"]

    bend_faces = {int(c[8]) for c in raw_cylinders_full}
    bl = meas["bend_line_length"]
    assert len(bl["occurrences"]) == result["bend_count"]
    assert bl["reconciles"] is True
    assert bl["value"] == pytest.approx(sum(o["length_mm"] for o in bl["occurrences"]), abs=0.2) and bl["value"] > 0
    assert {f for o in bl["occurrences"] for f in o["face_ids"]} <= bend_faces

    area = meas["flat_pattern_area"]
    assert area["value"] == result["flat_pattern_area_mm2"]
    area_faces = set(area["occurrences"][0]["face_ids"])
    assert bend_faces <= area_faces, "bend surfaces are part of the flat blank"
    assert len(area_faces) > len(bend_faces), "and so is at least one panel face"


def _plate_with_holes_and_cutout():
    from OCC.Core.BRepAlgoAPI import BRepAlgoAPI_Cut as Cut
    shape = BRepPrimAPI_MakeBox(200.0, 100.0, 2.0).Shape()
    for i in range(6):
        hole = BRepPrimAPI_MakeCylinder(gp_Ax2(gp_Pnt(20.0 + i * 25.0, 20.0, -1.0), gp_Dir(0, 0, 1)), 4.0, 4.0).Shape()
        shape = Cut(shape, hole).Shape()
    cutout = BRepPrimAPI_MakeBox(gp_Pnt(60.0, 50.0, -1.0), 40.0, 25.0, 4.0).Shape()
    return Cut(shape, cutout).Shape()


def test_measured_numbers_are_accounted_for_by_their_faces():
    """The popup shows the faces behind a number; they must add up to that number."""
    shape = _plate_with_holes_and_cutout()
    result, _ = _extract(shape)
    fg = result["feature_graph_v2"]
    n_faces = len(_faces(shape))

    # cut length: the per-category lengths on the highlight add up to the reported total
    blank = next(f for f in fg["features"] if f["feature_type"] == "Blank")
    assert sum(o["length_mm"] for o in blank["occurrences"]) == pytest.approx(result["cut_length_mm"], abs=0.3)

    # pierces: one occurrence per pierce, so the faces account for the count exactly
    pierce = fg["measurements"]["pierce_count"]
    assert pierce["reconciles"] is True
    assert len(pierce["occurrences"]) == pierce["value"] == result["pierce_count"]
    assert sorted({o["kind"] for o in pierce["occurrences"]}) == ["hole", "initial_pierce"] or "slot" in {o["kind"] for o in pierce["occurrences"]}

    # every face id the UI will highlight exists on this part
    every_id = [f for o in pierce["occurrences"] for f in o["face_ids"]] + [f for o in blank["occurrences"] for f in o["face_ids"]]
    assert every_id and all(0 <= f < n_faces for f in every_id)


def test_bend_lengths_reported_are_the_lengths_the_highlight_shows():
    """The longest bend the calculator uses is the longest bend the popup highlights."""
    shape = make_bent_sheet(seg_lens=[30.0, 20.0, 30.0], angles_deg=[90.0, 90.0])
    result, _ = _extract(shape)
    occ = result["feature_graph_v2"]["measurements"]["bend_line_length"]["occurrences"]
    assert result["bend_count"] == len(occ) > 0
    assert sorted(result["bend_lengths_mm"]) == pytest.approx(sorted(round(o["length_mm"], 1) for o in occ), abs=0.11)
    assert max(result["bend_lengths_mm"]) == pytest.approx(max(o["length_mm"] for o in occ), abs=0.11)
