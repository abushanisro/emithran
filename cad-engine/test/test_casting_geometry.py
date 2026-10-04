"""Real B-Rep tests for shared/casting_geometry.py — solids built with OCC,
expected values from the solid's own exact dimensions."""
import math

import pytest

pytest.importorskip("OCC")
pytest.importorskip("shapely")

from OCC.Core.BRepAlgoAPI import BRepAlgoAPI_Cut
from OCC.Core.BRepPrimAPI import BRepPrimAPI_MakeBox, BRepPrimAPI_MakeCylinder
from OCC.Core.gp import gp_Ax2, gp_Dir, gp_Pnt

from shared.casting_geometry import parting_plane_silhouette, projected_area_mm2, wall_thickness_profile


def test_box_projected_area_along_each_axis():
    box = BRepPrimAPI_MakeBox(50.0, 40.0, 20.0).Shape()
    assert projected_area_mm2(box, [0, 0, 1]) == pytest.approx(2000.0, rel=1e-6)
    assert projected_area_mm2(box, [1, 0, 0]) == pytest.approx(800.0, rel=1e-6)
    assert projected_area_mm2(box, [0, 1, 0]) == pytest.approx(1000.0, rel=1e-6)


def test_through_hole_removes_its_area_but_a_blind_pocket_does_not():
    box = BRepPrimAPI_MakeBox(50.0, 40.0, 20.0).Shape()
    through = BRepAlgoAPI_Cut(box, BRepPrimAPI_MakeCylinder(gp_Ax2(gp_Pnt(25, 20, -1), gp_Dir(0, 0, 1)), 5.0, 22.0).Shape()).Shape()
    blind = BRepAlgoAPI_Cut(box, BRepPrimAPI_MakeCylinder(gp_Ax2(gp_Pnt(25, 20, 10), gp_Dir(0, 0, 1)), 5.0, 11.0).Shape()).Shape()
    hole = math.pi * 25.0
    # Tessellation chord error on a 5 mm circle at 0.1 mm deflection is well under 1%.
    assert projected_area_mm2(through, [0, 0, 1]) == pytest.approx(2000.0 - hole, rel=0.005)
    assert projected_area_mm2(blind, [0, 0, 1]) == pytest.approx(2000.0, rel=1e-6)


def test_open_shell_wall_thickness_is_its_wall():
    # 60x60x40 open-top box, 3 mm walls and floor.
    outer = BRepPrimAPI_MakeBox(60.0, 60.0, 40.0).Shape()
    inner = BRepPrimAPI_MakeBox(gp_Pnt(3, 3, 3), 54.0, 54.0, 40.0).Shape()
    shell = BRepAlgoAPI_Cut(outer, inner).Shape()
    prof = wall_thickness_profile(shell)
    assert prof["wall_thickness_sample_count"] > 0
    assert prof["wall_thickness_nominal_mm"] == pytest.approx(3.0, abs=0.01)
    assert prof["wall_thickness_min_mm"] == pytest.approx(3.0, abs=0.01)


def test_die_casting_extractor_reports_casting_geometry():
    from die_casting.feature_extractor import DieCastingFeatureExtractor
    outer = BRepPrimAPI_MakeBox(60.0, 60.0, 40.0).Shape()
    inner = BRepPrimAPI_MakeBox(gp_Pnt(3, 3, 3), 54.0, 54.0, 40.0).Shape()
    shell = BRepAlgoAPI_Cut(outer, inner).Shape()
    out = DieCastingFeatureExtractor().extract(shell, [60.0, 60.0, 40.0])
    axis = out["primary_setup_axis"]
    assert axis is not None
    # Silhouette along whichever axis was chosen equals that face's full outline.
    expected = 3600.0 if abs(axis[2]) == 1 else 2400.0
    assert out["projected_area_mm2"] == pytest.approx(expected, rel=1e-6)
    assert out["wall_thickness_nominal_mm"] == pytest.approx(3.0, abs=0.01)


def test_solid_block_thickest_wall_is_its_smallest_dimension():
    # The largest ball inside a 50 x 40 x 20 block is 20 mm across; the 50 mm
    # ray through its end faces is length, not wall.
    box = BRepPrimAPI_MakeBox(50.0, 40.0, 20.0).Shape()
    prof = wall_thickness_profile(box)
    assert prof["wall_thickness_min_mm"] == pytest.approx(20.0, abs=0.01)
    assert prof["wall_thickness_max_mm"] == pytest.approx(20.0, abs=0.05)
    assert prof["wall_thickness_max_method"] == "inscribed_sphere"


def test_long_rib_does_not_read_as_a_thick_wall():
    from OCC.Core.BRepAlgoAPI import BRepAlgoAPI_Fuse
    from OCC.Core.gp import gp_Pnt
    # A 3 mm plate with a 6 x 6 x 100 mm solid rib on it: the rib end face's
    # ray crosses 100 mm of metal, but no wall is thicker than the 9 mm where
    # the rib stands on the plate.
    plate = BRepPrimAPI_MakeBox(120.0, 40.0, 3.0).Shape()
    rib = BRepPrimAPI_MakeBox(gp_Pnt(10.0, 17.0, 3.0), 100.0, 6.0, 6.0).Shape()
    part = BRepAlgoAPI_Fuse(plate, rib).Shape()
    prof = wall_thickness_profile(part)
    assert prof["wall_thickness_max_mm"] <= 9.0 + 0.1
    assert prof["wall_thickness_max_mm"] >= 6.0 - 0.1


def test_footprint_is_the_silhouette_extent_on_the_parting_plane():
    box = BRepPrimAPI_MakeBox(50.0, 40.0, 20.0).Shape()
    s = parting_plane_silhouette(box, [1, 0, 0])
    assert sorted(s["footprint_mm"]) == pytest.approx([20.0, 40.0], abs=1e-6)
    s = parting_plane_silhouette(box, [0, 0, 1])
    assert sorted(s["footprint_mm"]) == pytest.approx([40.0, 50.0], abs=1e-6)


def test_pull_extent_is_the_part_depth_along_the_pull_axis():
    box = BRepPrimAPI_MakeBox(50.0, 40.0, 20.0).Shape()
    assert parting_plane_silhouette(box, [1, 0, 0])["pull_extent_mm"] == pytest.approx(50.0, abs=1e-6)
    assert parting_plane_silhouette(box, [0, 0, 1])["pull_extent_mm"] == pytest.approx(20.0, abs=1e-6)
    # An oblique axis: the projection of the box diagonal span onto it.
    import math
    k = 1 / math.sqrt(2)
    assert parting_plane_silhouette(box, [k, k, 0])["pull_extent_mm"] == pytest.approx((50.0 + 40.0) * k, abs=1e-6)


def test_parting_perimeter_is_the_outer_silhouette_boundary():
    from OCC.Core.BRepAlgoAPI import BRepAlgoAPI_Cut
    from OCC.Core.BRepPrimAPI import BRepPrimAPI_MakeCylinder
    from OCC.Core.gp import gp_Ax2, gp_Pnt, gp_Dir
    box = BRepPrimAPI_MakeBox(50.0, 40.0, 20.0).Shape()
    assert parting_plane_silhouette(box, [0, 0, 1])["parting_perimeter_mm"] == pytest.approx(180.0, abs=1e-6)
    # A through hole along the pull is an inner boundary: the parting line is unchanged.
    hole = BRepPrimAPI_MakeCylinder(gp_Ax2(gp_Pnt(25, 20, -1), gp_Dir(0, 0, 1)), 5.0, 22.0).Shape()
    holed = BRepAlgoAPI_Cut(box, hole).Shape()
    assert parting_plane_silhouette(holed, [0, 0, 1])["parting_perimeter_mm"] == pytest.approx(180.0, abs=1e-6)
