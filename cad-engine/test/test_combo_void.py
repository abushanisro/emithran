import pytest

pytest.importorskip("OCC")

from OCC.Core.BRepPrimAPI import BRepPrimAPI_MakeBox, BRepPrimAPI_MakeCylinder
from OCC.Core.BRepAlgoAPI import BRepAlgoAPI_Cut
from OCC.Core.gp import gp_Ax2, gp_Pnt, gp_Dir

from die_casting.features.base_properties import analyze_base_properties
from die_casting.features.combo_void import detect_voids


def test_straight_blind_pocket_produces_no_void_candidate():
    """A straight blind pocket (open at top, reachable by a straight pull)
    must never be promoted -- its walls are vertical (undrafted, not
    undercut) and its floor is excluded as a base face; Stage 1 should never
    even flag a candidate for it."""
    box = BRepPrimAPI_MakeBox(50.0, 50.0, 20.0).Shape()
    axis = gp_Ax2(gp_Pnt(25.0, 25.0, 20.0), gp_Dir(0, 0, -1))
    pocket = BRepPrimAPI_MakeCylinder(axis, 8.0, 10.0).Shape()
    shape = BRepAlgoAPI_Cut(box, pocket).Shape()
    base = analyze_base_properties(shape, [50.0, 50.0, 20.0])
    result = detect_voids(shape, [50.0, 50.0, 20.0], base["primary_setup_axis"])
    assert result["void_count"] == 0
    assert result["slide_bundle_count"] == 0


def test_fully_enclosed_tunnel_promotes_to_a_recognized_void_and_slide_bundle():
    """A horizontal tunnel fully sandwiched between real part material above
    and below (cut straight through along Y, leaving solid material both at
    higher and lower Z) cannot be reached by a straight +/-Z pull -- its
    ceiling face is blocked both ways by real OCC ray intersection, so it
    must promote to a recognized Void and group into one SlideBundle."""
    box = BRepPrimAPI_MakeBox(60.0, 50.0, 20.0).Shape()
    # Tunnel cross-section 10(x) x 10(z), centered in x (20..30) and z
    # (5..15), cut all the way through in Y (0..50) -- material remains at
    # z=0..5 (below) and z=15..20 (above), and at x<20/x>30 (sides).
    tunnel = BRepPrimAPI_MakeBox(gp_Pnt(20.0, -1.0, 5.0), 10.0, 52.0, 10.0).Shape()
    shape = BRepAlgoAPI_Cut(box, tunnel).Shape()
    base = analyze_base_properties(shape, [60.0, 50.0, 20.0])
    assert base["primary_setup_axis_name"] == "z"
    result = detect_voids(shape, [60.0, 50.0, 20.0], base["primary_setup_axis"])
    print(result)
    assert result["void_count"] == 1
    occ = result["void_candidates"][0]
    assert occ["recognition_status"] == "recognized"
    assert occ["retraction_axis_name"] == "z"
    assert result["slide_bundle_count"] == 1
    assert result["slide_bundle_candidates"][0]["member_count"] == 1
    # The slide forms its member voids: the bundle names their faces, so it can be measured.
    assert result["slide_bundle_candidates"][0]["face_ids"] == sorted(occ["face_ids"])
    # ComboVoid is deliberately not detected this phase.
    assert result["combo_void_count"] == 0
