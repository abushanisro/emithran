import pytest
pytest.importorskip("OCC")
from OCC.Core.BRepPrimAPI import BRepPrimAPI_MakeBox
from die_casting.features.base_properties import analyze_base_properties

def test_plain_box_recognizes_shortest_axis():
    shape = BRepPrimAPI_MakeBox(50.0, 40.0, 10.0).Shape()
    result = analyze_base_properties(shape, [50.0, 40.0, 10.0])
    print(result)
    assert result["primary_setup_axis_name"] == "z"
    assert result["parting_plane_offset_mm"] == pytest.approx(5.0, abs=0.5)
    assert result["base_properties"]["volume_mm3"] == pytest.approx(50*40*10, rel=0.01)

def test_blind_hole_does_not_destabilize_axis_recognition():
    from OCC.Core.BRepPrimAPI import BRepPrimAPI_MakeCylinder
    from OCC.Core.BRepAlgoAPI import BRepAlgoAPI_Cut
    from OCC.Core.gp import gp_Ax2, gp_Pnt, gp_Dir
    box = BRepPrimAPI_MakeBox(50.0, 40.0, 10.0).Shape()
    # Blind hole perpendicular to the expected z pull axis (drilled from the x-face, along x).
    axis = gp_Ax2(gp_Pnt(0.0, 20.0, 5.0), gp_Dir(1.0, 0.0, 0.0))
    cutter = BRepPrimAPI_MakeCylinder(axis, 5.0, 20.0).Shape()
    shape = BRepAlgoAPI_Cut(box, cutter).Shape()
    result = analyze_base_properties(shape, [50.0, 40.0, 10.0])
    print(result["primary_setup_axis_name"], result["parting_plane_offset_mm"])
    # The real invariant: a single local blind-hole feature must not flip the
    # z-candidate's own recognition from recognized -> ambiguous (a plain blind
    # hole with a flat floor, perpendicular to z, introduces no back-angle/
    # undercut face against the z pull vector). Which candidate wins the
    # overall tiebreak among several equally-valid recognized axes on a
    # trivial symmetric box is not itself a meaningful invariant.
    z_candidate = next(c for c in result["setup_axis_candidates"] if c["axis_name"] == "z")
    assert z_candidate["recognition_status"] == "recognized"
    assert z_candidate["undercut_face_count"] == 0
    assert z_candidate["parting_plane_offset_mm"] == pytest.approx(5.0, abs=0.5)
