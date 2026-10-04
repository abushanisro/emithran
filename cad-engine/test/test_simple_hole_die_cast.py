import pytest

pytest.importorskip("OCC")

from OCC.Core.BRepPrimAPI import BRepPrimAPI_MakeBox, BRepPrimAPI_MakeCylinder
from OCC.Core.BRepAlgoAPI import BRepAlgoAPI_Cut, BRepAlgoAPI_Fuse
from OCC.Core.gp import gp_Ax2, gp_Pnt, gp_Dir

from die_casting.features.simple_hole import detect_holes, BLIND_HOLE_LD_CEILING
from shared.machining_geometry import part_bounding_box


def _box():
    return BRepPrimAPI_MakeBox(60.0, 50.0, 40.0).Shape()


def _stepped_tool(cx, cy, cz, steps):
    """steps: [(radius, depth), ...] widest/shallowest first -- same proven
    construction as test_multistep_holes.py's _make_3step_tool: every cylinder
    shares the SAME axis origin and direction, only height/radius differ, then
    fused -- not cut individually at different start points (which gives each
    face a different reported Location() and fails the real coaxial-centroid
    tolerance detect_multistep_holes uses)."""
    axis = gp_Ax2(gp_Pnt(cx, cy, cz), gp_Dir(0, 0, -1))
    tool = BRepPrimAPI_MakeCylinder(axis, steps[0][0], steps[0][1]).Shape()
    for radius, depth in steps[1:]:
        ax = gp_Ax2(gp_Pnt(cx, cy, cz), gp_Dir(0, 0, -1))
        tool = BRepAlgoAPI_Fuse(tool, BRepPrimAPI_MakeCylinder(ax, radius, depth).Shape()).Shape()
    return tool


def test_three_coaxial_decreasing_diameters_is_one_multistep_hole():
    box = _box()
    tool = _stepped_tool(30.0, 25.0, 40.0, [(5.0, 10.0), (3.0, 20.0), (1.5, 28.0)])
    shape = BRepAlgoAPI_Cut(box, tool).Shape()
    bbox = part_bounding_box(shape)
    result = detect_holes(shape, bbox, primary_setup_axis=[0.0, 0.0, 1.0])
    assert result["multi_step_hole_count"] == 1
    occ = result["multi_step_hole_candidates"][0]
    assert occ["step_count"] == 3
    assert occ["monotonic"] is True
    assert occ["max_diameter_mm"] == pytest.approx(10.0, abs=0.1)
    assert occ["min_diameter_mm"] == pytest.approx(3.0, abs=0.1)
    # No simple holes left over once claimed by the multistep group.
    assert result["simple_hole_count"] == 0


def test_two_coaxial_cylinders_is_not_a_multistep_hole():
    box = _box()
    tool = _stepped_tool(30.0, 25.0, 40.0, [(5.0, 10.0), (3.0, 20.0)])
    shape = BRepAlgoAPI_Cut(box, tool).Shape()
    bbox = part_bounding_box(shape)
    result = detect_holes(shape, bbox, primary_setup_axis=[0.0, 0.0, 1.0])
    assert result["multi_step_hole_count"] == 0


def test_blind_hole_exceeding_generic_ld_ceiling_is_flagged():
    box = _box()
    # A single blind hole: radius 1.2mm, depth 8mm -> L/D ~ 6.67, exceeds the
    # real generic ceiling (2.00, memory/Die Casting/Lookup/tblDTCLimits.csv).
    axis = gp_Ax2(gp_Pnt(30.0, 25.0, 40.0), gp_Dir(0, 0, -1))
    cutter = BRepPrimAPI_MakeCylinder(axis, 1.2, 8.0).Shape()
    shape = BRepAlgoAPI_Cut(box, cutter).Shape()
    bbox = part_bounding_box(shape)
    result = detect_holes(shape, bbox, primary_setup_axis=[0.0, 0.0, 1.0])
    assert result["simple_hole_count"] == 1
    occ = result["simple_hole_candidates"][0]
    assert occ["blind"] is True
    assert occ["ld_ratio"] > BLIND_HOLE_LD_CEILING
    assert occ["exceeds_blind_hole_ld_ceiling"] is True
    assert occ["blind_hole_ld_ceiling"] == BLIND_HOLE_LD_CEILING
