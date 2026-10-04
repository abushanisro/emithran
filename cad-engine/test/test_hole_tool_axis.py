import pytest

pytest.importorskip("OCC")

from OCC.Core.BRepAlgoAPI import BRepAlgoAPI_Cut  # noqa: E402
from OCC.Core.BRepPrimAPI import BRepPrimAPI_MakeBox, BRepPrimAPI_MakeCylinder  # noqa: E402
from OCC.Core.gp import gp_Ax2, gp_Dir, gp_Pnt  # noqa: E402

from die_casting.features.simple_hole import detect_holes  # noqa: E402
from die_casting.features.surfaces import classify_surfaces  # noqa: E402

BBOX = {"xmin": 0, "ymin": 0, "zmin": 0, "xmax": 60, "ymax": 50, "zmax": 20}


def _box_with(*holes):
    shape = BRepPrimAPI_MakeBox(60.0, 50.0, 20.0).Shape()
    for h in holes:
        shape = BRepAlgoAPI_Cut(shape, h).Shape()
    return shape


def test_blind_hole_tool_axis_points_out_of_its_open_end():
    # Drilled 10 mm down from the top face (z = 20): reachable only from +z.
    blind = BRepPrimAPI_MakeCylinder(gp_Ax2(gp_Pnt(20, 25, 10), gp_Dir(0, 0, 1)), 4.0, 11.0).Shape()
    holes = detect_holes(_box_with(blind), BBOX, [0.0, 0.0, 1.0])["simple_hole_candidates"]
    occ = next(h for h in holes if h["variant"] == "blind")
    assert occ["tool_axis_bidirectional"] is False
    assert occ["tool_axis"] == pytest.approx([0.0, 0.0, 1.0], abs=1e-6)


def test_through_hole_is_reachable_from_either_end():
    through = BRepPrimAPI_MakeCylinder(gp_Ax2(gp_Pnt(40, 25, -1), gp_Dir(0, 0, 1)), 4.0, 22.0).Shape()
    holes = detect_holes(_box_with(through), BBOX, [0.0, 0.0, 1.0])["simple_hole_candidates"]
    occ = next(h for h in holes if h["variant"] == "through")
    assert occ["tool_axis_bidirectional"] is True
    assert abs(abs(occ["tool_axis"][2]) - 1.0) < 1e-6


def test_planar_face_tool_axis_is_the_outward_normal():
    shape = BRepPrimAPI_MakeBox(60.0, 50.0, 20.0).Shape()
    faces = classify_surfaces(shape, set())["planar_face_candidates"]
    for f in faces:
        cx, cy, cz = f["centroid_mm"]
        # The outward normal points away from the box centre (30, 25, 10).
        n = f["tool_axis"]
        assert (cx - 30) * n[0] + (cy - 25) * n[1] + (cz - 10) * n[2] > 0
