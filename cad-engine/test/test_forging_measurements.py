"""Forging measurements on solids built with OCC: every expected value is the solid's own exact dimension."""
import math

import pytest

pytest.importorskip("OCC")
pytest.importorskip("shapely")

from OCC.Core.BRepAdaptor import BRepAdaptor_Curve
from OCC.Core.BRepAlgoAPI import BRepAlgoAPI_Cut, BRepAlgoAPI_Fuse
from OCC.Core.BRepFilletAPI import BRepFilletAPI_MakeFillet
from OCC.Core.BRepPrimAPI import BRepPrimAPI_MakeBox, BRepPrimAPI_MakeCylinder
from OCC.Core.GeomAbs import GeomAbs_Circle
from OCC.Core.gp import gp_Ax2, gp_Dir, gp_Pnt
from OCC.Core.TopAbs import TopAbs_EDGE
from OCC.Core.TopExp import TopExp_Explorer
from OCC.Core.TopoDS import topods

from forging.feature_extractor import ForgingFeatureExtractor
from shared.memory_optimizer import AdvancedCADMemoryOptimizer
from shared.part_family import FORGED, POWDER_METAL
from shared.section_profile import section_area_profile


def _cylinder(origin, direction, radius, height):
    return BRepPrimAPI_MakeCylinder(gp_Ax2(gp_Pnt(*origin), gp_Dir(*direction)), radius, height).Shape()


def _stepped_shaft():
    """Along X: 60 mm of diameter 40, then 40 mm of diameter 20."""
    return BRepAlgoAPI_Fuse(_cylinder((0, 0, 0), (1, 0, 0), 20.0, 60.0), _cylinder((60, 0, 0), (1, 0, 0), 10.0, 40.0)).Shape()


def _angle_deg(a, b):
    return math.degrees(math.acos(min(1.0, abs(sum(x * y for x, y in zip(a, b))))))


def _edges(shape):
    explorer = TopExp_Explorer(shape, TopAbs_EDGE)
    while explorer.More():
        yield topods.Edge(explorer.Current())
        explorer.Next()


def _fillet(shape, radius, wanted):
    """`shape` with the first edge `wanted(curve, midpoint)` accepts rounded to `radius`."""
    for edge in _edges(shape):
        curve = BRepAdaptor_Curve(edge)
        mid = curve.Value((curve.FirstParameter() + curve.LastParameter()) / 2.0)
        if wanted(curve, mid):
            maker = BRepFilletAPI_MakeFillet(shape)
            maker.Add(radius, edge)
            return maker.Shape()
    raise AssertionError("the edge to round was not found")


def test_section_profile_of_a_stepped_shaft_is_its_two_circles_and_adds_up_to_its_volume():
    profile = section_area_profile(_stepped_shaft(), [1, 0, 0], stations=20)
    big, small = math.pi * 400.0, math.pi * 100.0
    assert profile["length_mm"] == pytest.approx(100.0, abs=1e-3)
    assert profile["failed_stations"] == 0
    assert profile["areas_mm2"][:12] == pytest.approx([big] * 12, rel=1e-4)
    assert profile["areas_mm2"][12:] == pytest.approx([small] * 8, rel=1e-4)
    assert profile["max_area_mm2"] == pytest.approx(big, rel=1e-4)
    assert profile["volume_from_profile_mm3"] == pytest.approx(big * 60.0 + small * 40.0, rel=1e-4)


def test_section_profile_across_a_box_is_constant_whatever_the_axis_sign():
    box = BRepPrimAPI_MakeBox(50.0, 40.0, 20.0).Shape()
    profile = section_area_profile(box, [0, 0, -2], stations=5)
    assert profile["areas_mm2"] == pytest.approx([2000.0] * 5, rel=1e-6)
    assert profile["length_mm"] == pytest.approx(20.0, abs=1e-6)


def test_stepped_shaft_is_forged_across_its_axis_with_the_bar_along_it():
    out = ForgingFeatureExtractor().extract(_stepped_shaft(), [100.0, 40.0, 40.0])
    # Along the axis nothing is covered either, but the side view is the larger outline: the dies close across the shaft.
    assert _angle_deg(out["die_direction"]["vector"], (1, 0, 0)) == pytest.approx(90.0, abs=0.5)
    assert out["die_direction"]["source"] == "auto"
    assert out["die_direction"]["undercut_area_mm2"] == pytest.approx(0.0, abs=1.0)
    assert out["projected_area_mm2"] == pytest.approx(60.0 * 40.0 + 40.0 * 20.0, rel=0.01)
    assert out["parting_perimeter_mm"] == pytest.approx(2 * 100.0 + 2 * 40.0, rel=0.01)  # the outline of the two rectangles
    assert out["die_depth_mm"] == pytest.approx(40.0, rel=0.01)
    assert _angle_deg(out["plan"]["long_axis"], (1, 0, 0)) == pytest.approx(0.0, abs=0.5)
    assert out["plan"]["length_mm"] == pytest.approx(100.0, rel=0.005)
    assert out["plan"]["width_mm"] == pytest.approx(40.0, rel=0.01)
    assert out["section_profile"]["max_area_mm2"] == pytest.approx(math.pi * 400.0, rel=1e-3)
    assert out["trapped_volumes"]["count"] == 0
    # No hole; every face is a feature the process tree lists and a click highlights: the two cylinders, their ends and the step.
    features = out["feature_graph_v2"]["features"]
    assert {f["feature_type"] for f in features} <= {"PlanarFace", "CurvedWall", "CurvedSurface", "SharpEdge", "Void"}
    covered = {fid for f in features if f["feature_type"] != "SharpEdge" for o in f["occurrences"] for fid in o["face_ids"]}
    assert covered == set(range(len(out["draft"]["faces"]))) or len(covered) >= 5


def test_flange_is_forged_along_its_bore_and_the_bore_is_a_hole_along_the_die_direction():
    disc = _cylinder((0, 0, 0), (0, 0, 1), 50.0, 20.0)
    flange = BRepAlgoAPI_Cut(disc, _cylinder((0, 0, -1), (0, 0, 1), 15.0, 22.0)).Shape()
    out = ForgingFeatureExtractor().extract(flange, [100.0, 100.0, 20.0])
    assert _angle_deg(out["die_direction"]["vector"], (0, 0, 1)) == pytest.approx(0.0, abs=0.5)
    assert out["projected_area_mm2"] == pytest.approx(math.pi * (2500.0 - 225.0), rel=0.01)
    assert out["parting_perimeter_mm"] == pytest.approx(2 * math.pi * 50.0, rel=0.01)  # the outer outline only: the bore is not flash length
    assert out["die_depth_mm"] == pytest.approx(20.0, abs=0.01)
    assert len(out["holes"]) == 1
    hole = out["holes"][0]
    assert hole["variant"] == "through"
    assert hole["diameter_mm"] == pytest.approx(30.0, abs=0.01)
    assert hole["depth_mm"] == pytest.approx(20.0, abs=0.05)
    assert hole["angle_to_die_deg"] == pytest.approx(0.0, abs=0.5)
    # The bore is also a hole feature, read by the tolerances and the machining after forging as every other analysis's holes are.
    [feature] = [f for f in out["feature_graph_v2"]["features"] if f["feature_type"] in ("SimpleHole", "MultiStepHole")]
    assert (feature["feature_type"], feature["variant"]) == ("SimpleHole", "through")
    # The bore's faces are the hole's alone: no face feature lists them again (an edge at its rim names the two faces it joins).
    others = {fid for f in out["feature_graph_v2"]["features"] if f is not feature and f["feature_type"] != "SharpEdge" for o in f["occurrences"] for fid in o["face_ids"]}
    assert not (set(hole["face_ids"]) & others)
    [occ] = feature["occurrences"]
    assert occ["diameter_mm"] == pytest.approx(30.0, abs=0.01)
    assert occ["depth_mm"] == pytest.approx(20.0, abs=0.05)
    assert occ["face_ids"] == hole["face_ids"]
    assert occ["angle_to_die_deg"] == pytest.approx(0.0, abs=0.5)


def test_a_side_groove_is_an_undercut_when_the_engineer_fixes_the_die_direction_across_it():
    block = BRepPrimAPI_MakeBox(60.0, 40.0, 30.0).Shape()
    grooved = BRepAlgoAPI_Cut(block, BRepPrimAPI_MakeBox(gp_Pnt(-1, -1, 10), 11.0, 42.0, 10.0).Shape()).Shape()
    out = ForgingFeatureExtractor().extract(grooved, [60.0, 40.0, 30.0], die_direction_override=(0.0, 0.0, 1.0))
    assert out["die_direction"]["source"] == "override"
    # The groove's floor and ceiling (10 x 40 each) are both covered along Z.
    assert out["die_direction"]["undercut_area_mm2"] == pytest.approx(800.0, rel=0.05)
    assert out["draft"]["undercut_area_mm2"] == pytest.approx(800.0, rel=0.05)
    assert sum(1 for f in out["draft"]["faces"] if f["undercut_fraction"] > 0.5) == 2
    # Left to itself the analysis finds a direction that releases the groove.
    free = ForgingFeatureExtractor().extract(grooved, [60.0, 40.0, 30.0])
    assert free["die_direction"]["undercut_area_mm2"] == pytest.approx(0.0, abs=1.0)


def test_web_between_two_pockets_is_the_thinnest_section():
    block = BRepPrimAPI_MakeBox(60.0, 40.0, 20.0).Shape()
    upper = BRepPrimAPI_MakeBox(gp_Pnt(5, 5, 12), 50.0, 30.0, 9.0).Shape()
    lower = BRepPrimAPI_MakeBox(gp_Pnt(5, 5, -1), 50.0, 30.0, 9.0).Shape()
    h_section = BRepAlgoAPI_Cut(BRepAlgoAPI_Cut(block, upper).Shape(), lower).Shape()
    out = ForgingFeatureExtractor().extract(h_section, [60.0, 40.0, 20.0])
    assert _angle_deg(out["die_direction"]["vector"], (0, 0, 1)) == pytest.approx(0.0, abs=0.5)
    assert out["section_thickness"]["min_mm"] == pytest.approx(4.0, abs=0.2)  # the web: 20 - 8 - 8
    assert out["section_thickness"]["max_mm"] <= 20.0 + 0.2
    # The pocket walls stand along the die direction: no draft.
    assert any(f["draft_deg"] is not None and f["draft_deg"] < 0.3 for f in out["draft"]["faces"])


def test_inside_and_outside_rounds_are_told_apart_with_their_radius():
    l_block = BRepAlgoAPI_Cut(BRepPrimAPI_MakeBox(40.0, 40.0, 20.0).Shape(), BRepPrimAPI_MakeBox(gp_Pnt(20, 20, -1), 21.0, 21.0, 22.0).Shape()).Shape()
    sharp = ForgingFeatureExtractor().extract(l_block, [40.0, 40.0, 20.0])
    assert sharp["radii"] == []
    assert sharp["sharp_edges"]["internal_count"] == 1
    assert sharp["sharp_edges"]["internal_length_mm"] == pytest.approx(20.0, abs=0.01)

    def vertical_at(x, y):
        return lambda curve, mid: abs(mid.X() - x) < 1e-6 and abs(mid.Y() - y) < 1e-6

    rounded = _fillet(_fillet(l_block, 3.0, vertical_at(20.0, 20.0)), 5.0, vertical_at(0.0, 0.0))
    out = ForgingFeatureExtractor().extract(rounded, [40.0, 40.0, 20.0])
    assert [(r["kind"], r["radius_mm"], r["surface"]) for r in out["radii"]] == [("corner", 5.0, "cylinder"), ("fillet", 3.0, "cylinder")]
    assert out["sharp_edges"]["internal_count"] == 0


def test_round_at_the_foot_of_a_boss_is_a_fillet_on_a_torus():
    plate = BRepPrimAPI_MakeBox(gp_Pnt(-30, -30, 0), 60.0, 60.0, 10.0).Shape()
    bossed = BRepAlgoAPI_Fuse(plate, _cylinder((0, 0, 10), (0, 0, 1), 15.0, 20.0)).Shape()
    rounded = _fillet(bossed, 3.0, lambda curve, mid: curve.GetType() == GeomAbs_Circle and abs(mid.Z() - 10.0) < 1e-6)
    out = ForgingFeatureExtractor().extract(rounded, [60.0, 60.0, 30.0])
    torus = [r for r in out["radii"] if r["surface"] == "torus"]
    assert [(r["kind"], r["radius_mm"]) for r in torus] == [("fillet", 3.0)]


def test_family_hint_forged_runs_the_forging_measurements():
    shape = BRepPrimAPI_MakeBox(50.0, 40.0, 20.0).Shape()
    result = AdvancedCADMemoryOptimizer().analyze_and_optimize(shape, family_hint="forged")
    mi = result.geometry_features.manufacturing_features["manufacturing_intelligence"]
    assert mi["detected_family"] == FORGED
    assert mi["features"]["extraction_version"] == "forging_measurements_v1"
    assert mi["features"]["projected_area_mm2"] == pytest.approx(2000.0, rel=1e-6)
    assert mi["features"]["die_direction"]["axis"] == "z"


def test_family_hint_powder_metal_measures_the_part_along_its_press_direction():
    # A bushing pressed along its bore: the press direction, the pressed outline (the ring) and the height are the forging measurements.
    bushing = BRepAlgoAPI_Cut(_cylinder((0, 0, 0), (0, 0, 1), 15.0, 20.0), _cylinder((0, 0, -1), (0, 0, 1), 7.5, 22.0)).Shape()
    result = AdvancedCADMemoryOptimizer().analyze_and_optimize(bushing, family_hint="powder_metal")
    mi = result.geometry_features.manufacturing_features["manufacturing_intelligence"]
    assert mi["detected_family"] == POWDER_METAL
    assert mi["features"]["die_direction"]["axis"] == "z"
    assert mi["features"]["projected_area_mm2"] == pytest.approx(math.pi * (225.0 - 56.25), rel=0.01)
    assert mi["features"]["die_depth_mm"] == pytest.approx(20.0, abs=0.01)


def test_each_measurement_names_its_faces_for_the_calculator_eye():
    # A flange: the ring seen along its bore is the projected area; its outer cylinder is the parting line; its two flat ends its depth.
    disc = _cylinder((0, 0, 0), (0, 0, 1), 50.0, 20.0)
    flange = BRepAlgoAPI_Cut(disc, _cylinder((0, 0, -1), (0, 0, 1), 15.0, 22.0)).Shape()
    out = ForgingFeatureExtractor().extract(flange, [100.0, 100.0, 20.0])
    m = out["feature_graph_v2"]["measurements"]
    assert m["projected_area"]["value"] == pytest.approx(math.pi * (2500.0 - 225.0), rel=0.01)
    assert m["projected_area"]["reconciles"] is True
    top = m["projected_area"]["occurrences"][0]["face_ids"]
    assert len(top) == 1  # the one end face seen along the die direction
    assert len(m["die_depth"]["occurrences"][0]["face_ids"]) == 2  # both flat ends
    outer = m["parting_perimeter"]["occurrences"][0]["face_ids"]
    assert outer and not (set(outer) & set(out["holes"][0]["face_ids"]))  # the outer wall, never the bore
    assert m["part_volume"]["value"] == pytest.approx(math.pi * (2500.0 - 225.0) * 20.0, rel=1e-3)


def test_a_casting_records_the_same_measurement_faces_along_its_pull_axis():
    from die_casting.feature_extractor import DieCastingFeatureExtractor
    disc = _cylinder((0, 0, 0), (0, 0, 1), 50.0, 20.0)
    flange = BRepAlgoAPI_Cut(disc, _cylinder((0, 0, -1), (0, 0, 1), 15.0, 22.0)).Shape()
    out = DieCastingFeatureExtractor().extract(flange, [100.0, 100.0, 20.0])
    m = out["feature_graph_v2"]["measurements"]
    # The casting's own pull axis and its own numbers: the faces are those behind the projected area and parting line it costs with.
    assert m["projected_area"]["value"] == pytest.approx(out["projected_area_mm2"], rel=1e-6)
    assert m["parting_perimeter"]["value"] == pytest.approx(out["parting_perimeter_mm"], rel=1e-6)
    assert m["projected_area"]["occurrences"][0]["face_ids"]
    assert m["parting_perimeter"]["occurrences"][0]["face_ids"]
    assert m["die_depth"]["occurrences"][0]["face_ids"]
