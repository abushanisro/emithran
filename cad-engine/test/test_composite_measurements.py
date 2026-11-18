"""composites.feature_extractor on OCC-built laminates, each against hand-computed values."""
import math

import pytest

pytest.importorskip("OCC")
pytest.importorskip("shapely")

from OCC.Core.BRepAlgoAPI import BRepAlgoAPI_Cut, BRepAlgoAPI_Fuse  # noqa: E402
from OCC.Core.BRepPrimAPI import BRepPrimAPI_MakeBox, BRepPrimAPI_MakeCylinder  # noqa: E402
from OCC.Core.gp import gp_Ax2, gp_Dir, gp_Pnt  # noqa: E402

from composites.feature_extractor import CompositeFeatureExtractor  # noqa: E402


def box(x, y, z, at=(0.0, 0.0, 0.0)):
    return BRepPrimAPI_MakeBox(gp_Pnt(*at), x, y, z).Shape()


def measure(shape, dims):
    return CompositeFeatureExtractor().extract(shape, dims)


def test_a_flat_laminate_is_one_level_its_outline_and_no_curvature():
    # 300 x 200 x 3 mm: one 3 mm laminate laid on its 300 x 200 face, trimmed along 1000 mm.
    r = measure(box(300, 200, 3), [300, 200, 3])
    assert r["layup_direction"]["axis"] in ("z", "-z")
    assert r["surfaces"]["tool_area_mm2"] == pytest.approx(60000, rel=1e-3)
    [level] = r["thickness"]["levels"]
    assert level["thickness_mm"] == pytest.approx(3.0, abs=0.05)
    assert level["region_area_mm2"] == pytest.approx(60000, rel=1e-3)
    assert level["region_perimeter_mm"] == pytest.approx(1000, rel=1e-3)
    assert r["outline"]["trim_length_mm"] == pytest.approx(1000, rel=1e-3)
    assert r["outline"]["footprint_mm"] == pytest.approx([300, 200], rel=1e-3)
    assert r["outline"]["openings"] == []
    assert r["curvature"]["max_per_m"] == 0.0
    types = {f["feature_type"] for f in r["feature_graph_v2"]["features"]}
    assert {"ToolSurface", "LaminateZone", "TrimEdge"} <= types
    # The calculator eye: the faces behind each number the cost reads.
    m = r["feature_graph_v2"]["measurements"]
    assert m["tool_area"]["occurrences"][0]["face_ids"] == r["surfaces"]["tool_face_ids"]
    assert sorted(m["trim_length"]["occurrences"][0]["face_ids"]) == sorted(r["surfaces"]["edge_face_ids"])
    assert m["skin_area"]["value"] == pytest.approx(120000, rel=1e-3)
    assert len(m["layup_height"]["occurrences"][0]["face_ids"]) == 2
    assert m["footprint_length"]["value"] == pytest.approx(300, rel=1e-3)
    assert len(m["footprint_length"]["occurrences"][0]["face_ids"]) == 2


def test_a_ply_drop_off_is_a_second_level_covering_only_the_thick_region():
    # A 2 mm laminate with a 1 mm pad 100 x 100 on its bag side: the plies of the extra millimetre cover the pad only.
    r = measure(BRepAlgoAPI_Fuse(box(300, 200, 2), box(100, 100, 1, (100, 50, 2))).Shape(), [300, 200, 3])
    levels = r["thickness"]["levels"]
    assert [round(l["thickness_mm"], 1) for l in levels] == [2.0, 3.0]
    assert r["surfaces"]["tool_area_mm2"] == pytest.approx(60000, rel=1e-3)
    assert levels[1]["region_area_mm2"] == pytest.approx(10000, rel=1e-3)
    assert levels[1]["region_perimeter_mm"] == pytest.approx(400, rel=1e-3)
    # The whole bag side is at least 2 mm: its region is the part (less the pad's walls) and its outline the trim.
    assert levels[0]["region_area_mm2"] == pytest.approx(60000, rel=1e-3)
    assert levels[0]["region_perimeter_mm"] == pytest.approx(1000, rel=1e-3)


def test_a_sandwich_core_is_a_level_far_thicker_than_the_skins():
    # 2 mm skin with a 150 x 100 block 15 mm thick on it: the thick level is where the core is; which it is, is the backend's call.
    r = measure(BRepAlgoAPI_Fuse(box(300, 200, 2), box(150, 100, 15, (75, 50, 2))).Shape(), [300, 200, 17])
    levels = r["thickness"]["levels"]
    assert levels[0]["thickness_mm"] == pytest.approx(2.0, abs=0.05)
    assert levels[-1]["thickness_mm"] == pytest.approx(17.0, abs=0.2)
    assert levels[-1]["region_area_mm2"] == pytest.approx(15000, rel=1e-3)
    assert levels[-1]["region_perimeter_mm"] == pytest.approx(500, rel=1e-3)
    assert r["outline"]["height_mm"] == pytest.approx(17.0, abs=1e-3)


def test_a_cutout_is_an_opening_and_a_drilled_hole_is_a_hole():
    # 300 x 200 x 3 with a 50 x 40 cutout and a 6 mm hole: both are openings in the outline; only the round one is a hole, and the ply
    # outline runs round the cutout (cut in the ply) but not round the hole (drilled after cure).
    plate = BRepAlgoAPI_Cut(box(300, 200, 3), box(50, 40, 10, (50, 50, -2))).Shape()
    plate = BRepAlgoAPI_Cut(plate, BRepPrimAPI_MakeCylinder(gp_Ax2(gp_Pnt(220, 100, -2), gp_Dir(0, 0, 1)), 3.0, 10).Shape()).Shape()
    r = measure(plate, [300, 200, 3])
    openings = r["outline"]["openings"]
    assert len(openings) == 2
    assert openings[0]["area_mm2"] == pytest.approx(2000, rel=1e-2)
    assert openings[1]["area_mm2"] == pytest.approx(math.pi * 9, rel=0.05)
    assert r["outline"]["outer_area_mm2"] == pytest.approx(60000, rel=1e-3)
    assert r["outline"]["trim_length_mm"] == pytest.approx(1000, rel=1e-3)
    assert len(r["holes"]) == 1 and r["holes"][0]["diameter_mm"] == pytest.approx(6.0, abs=0.05)
    [level] = r["thickness"]["levels"]
    assert level["region_perimeter_mm"] == pytest.approx(1000 + 180, rel=1e-3)


def test_a_curved_shell_reports_its_curvature():
    # A half pipe, 200 mm outer radius, 3 mm thick, 400 mm long: the tool side is one cylinder skin, curvature 1/0.2 m or 1/0.197 m.
    ax = gp_Ax2(gp_Pnt(0, 0, 0), gp_Dir(0, 1, 0))
    tube = BRepAlgoAPI_Cut(BRepPrimAPI_MakeCylinder(ax, 200, 400).Shape(), BRepPrimAPI_MakeCylinder(ax, 197, 400).Shape()).Shape()
    half = BRepAlgoAPI_Cut(tube, box(500, 500, 500, (-250, -50, -500))).Shape()
    r = measure(half, [400, 400, 200])
    assert r["curvature"]["max_per_m"] == pytest.approx(1000 / 200, rel=0.02) or r["curvature"]["max_per_m"] == pytest.approx(1000 / 197, rel=0.02)
    assert r["curvature"]["near_max_area_fraction"] == pytest.approx(1.0, abs=0.01)
    [level] = r["thickness"]["levels"]
    assert level["thickness_mm"] == pytest.approx(3.0, abs=0.1)


def test_family_hint_composite_runs_the_laminate_measurements():
    from shared.memory_optimizer import AdvancedCADMemoryOptimizer
    from shared.part_family import COMPOSITE

    result = AdvancedCADMemoryOptimizer().analyze_and_optimize(box(300, 200, 3), family_hint="composite")
    mi = result.geometry_features.manufacturing_features["manufacturing_intelligence"]
    assert mi["detected_family"] == COMPOSITE
    assert mi["features"]["extraction_version"] == "composites-1"
    assert mi["features"]["thickness"]["skin_mm"] == pytest.approx(3.0, abs=0.05)
    assert mi["features"]["outline"]["trim_length_mm"] == pytest.approx(1000, rel=1e-3)
