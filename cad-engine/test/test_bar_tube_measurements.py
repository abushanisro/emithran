"""bar_tube: section, centreline, bends, holes, ends and end forms on OCC-built parts, against values worked out by hand."""
import math

import pytest

pytest.importorskip("OCC")

from bar_tube.centreline import Bend, chain_bends, clock_angles  # noqa: E402
from bar_tube.feature_extractor import BarTubeFeatureExtractor  # noqa: E402
from bar_tube.section import classify_section  # noqa: E402

import bar_tube_parts as P  # noqa: E402

OD, WALL = 25.4, 1.5
TUBE_AREA = math.pi / 4 * (OD ** 2 - (OD - 2 * WALL) ** 2)  # 112.626 mm2
SQUARE = P.polygon_face([(-20, -20), (20, -20), (20, 20), (-20, 20)], holes=[[(-17, -17), (17, -17), (17, 17), (-17, 17)]])


def extract(shape, dims, **kw):
    return BarTubeFeatureExtractor().extract(shape, dims, **kw)


def ends(out):
    return {e["end"]: e for e in out["ends"]}


def test_a_straight_round_tube():
    out = extract(P.straight_tube(OD, WALL, 1000), [1000, OD, OD])
    s = out["section"]
    assert out["stock_form"] == "ROUND_TUBE"
    assert s["od_mm"] == pytest.approx(OD, abs=0.01) and s["wall_mm"] == pytest.approx(WALL, abs=0.01)
    assert s["area_mm2"] == pytest.approx(TUBE_AREA, rel=2e-3)
    assert out["developed_length_mm"] == pytest.approx(1000.0, abs=0.01)
    assert out["bend_count"] == 0 and out["holes"] == []
    assert {k: e["variant"] for k, e in ends(out).items()} == {"start": "square", "end": "square"}
    assert out["feature_graph_v2"]["measurements"]["developed_length"]["value"] == pytest.approx(1000.0, abs=0.01)


def test_a_tube_bent_twice_in_one_plane():
    # 100 straight, 90 deg left on CLR 50, 80 straight, 45 deg right on CLR 50, 120 straight.
    out = extract(P.bent_tube(OD, WALL, [100, 80, 120], [(50, 90), (50, -45)]), [250, 250, OD])
    assert out["stock_form"] == "ROUND_TUBE" and out["axis_source"] == "bends"
    assert out["developed_length_mm"] == pytest.approx(300 + 50 * math.pi / 2 + 50 * math.pi / 4, abs=0.05)  # 417.81
    b = out["bends"]
    assert [x["clr_mm"] for x in b] == pytest.approx([50.0, 50.0])
    assert [x["angle_deg"] for x in b] == pytest.approx([90.0, 45.0], abs=0.01)
    assert [x["straight_before_mm"] for x in b] == pytest.approx([100.0, 80.0], abs=0.05)
    # The second bend turns the other way in the same plane: the tube is turned half a revolution between them.
    assert b[1]["clock_angle_deg"] == pytest.approx(180.0, abs=0.1)
    assert out["unique_bend_count"] == 2 and out["unique_clr_count"] == 1
    assert out["section"]["area_mm2"] == pytest.approx(TUBE_AREA, rel=2e-3)


def test_bends_out_of_plane_turn_the_tube_a_quarter():
    # Two 90 deg bends of CLR 50: the first about +z, the second (after a 100 mm straight) about the x axis, at right angles to it.
    b1 = Bend(centre=(0.0, 50.0, 0.0), axis=(0.0, 0.0, 1.0), x=(0.0, -1.0, 0.0), radius=50.0, t0=0.0, t1=math.pi / 2, section_radius=12.7)
    # b1 ends at (50, 50, 0) heading +y; 100 mm on to (50, 150, 0); b2 turns from +y toward +z about +x, centred at (50, 150, 50).
    b2 = Bend(centre=(50.0, 150.0, 50.0), axis=(1.0, 0.0, 0.0), x=(0.0, 0.0, -1.0), radius=50.0, t0=0.0, t1=math.pi / 2, section_radius=12.7)
    cl = chain_bends([b1, b2], [(-30.0, 0.0, 0.0), (50.0, 200.0, 130.0)], 0.05)
    assert cl is not None
    assert [s.kind for s in cl.segments] == ["straight", "bend", "straight", "bend", "straight"]
    assert clock_angles(cl) == pytest.approx([90.0], abs=0.01)
    assert cl.segments[2].length == pytest.approx(100.0, abs=1e-6)


def test_holes_drilled_through_both_walls():
    out = extract(P.drill(P.straight_tube(OD, WALL, 500), 250, 6), [500, OD, OD])
    assert out["stock_form"] == "ROUND_TUBE"
    assert [(h["feature_type"], h["diameter_mm"]) for h in out["holes"]] == [("SimpleHole", 6.0), ("SimpleHole", 6.0)]
    assert all(h["station_mm"] == pytest.approx(250.0, abs=0.5) for h in out["holes"])


def test_a_square_tube_and_a_slot_through_its_wall():
    out = extract(P.cut_box(P.prism(SQUARE, 600), (280, -8, 15), (40, 16, 10)), [600, 40, 40])
    assert out["stock_form"] == "SQUARE_TUBE"
    assert out["section"]["width_mm"] == pytest.approx(40.0) and out["section"]["wall_mm"] == pytest.approx(3.0)
    assert out["section"]["area_mm2"] == pytest.approx(40 ** 2 - 34 ** 2)
    # The 40 x 16 slot is closed within the top wall: a complex hole, its outline 2 x (40 + 16).
    assert len(out["complex_holes"]) == 1 and out["cutouts"] == []
    assert out["complex_holes"][0]["perimeter_mm"] == pytest.approx(112.0, abs=0.01)


def test_a_square_tube_bent_on_a_cylinder():
    out = extract(P.swept(SQUARE, [200, 150], [(80, 90)]), [300, 300, 40])
    assert out["stock_form"] == "SQUARE_TUBE"
    assert [(b["clr_mm"], b["angle_deg"], b["source"]) for b in out["bends"]] == [(80.0, 90.0, "cylinder")]
    assert out["developed_length_mm"] == pytest.approx(350 + 80 * math.pi / 2, abs=0.05)


def test_a_flat_bar_bent_the_easy_way():
    out = extract(P.swept(P.polygon_face([(-25, -3), (25, -3), (25, 3), (-25, 3)]), [200, 150], [(30, 90)]), [250, 250, 50])
    assert out["stock_form"] == "RECTANGULAR_BAR"
    assert (out["section"]["width_mm"], out["section"]["height_mm"]) == pytest.approx((50.0, 6.0))
    assert [(b["clr_mm"], b["angle_deg"]) for b in out["bends"]] == [(30.0, 90.0)]


@pytest.mark.parametrize("name, outline, form, area", [
    ("angle", [(0, 0), (50, 0), (50, 5), (5, 5), (5, 50), (0, 50)], "ANGLE_BAR", 475.0),
    ("channel", [(0, 0), (60, 0), (60, 30), (55, 30), (55, 5), (5, 5), (5, 30), (0, 30)], "CHANNEL_BAR", 550.0),
    ("tee", [(0, 0), (60, 0), (60, 6), (33, 6), (33, 40), (27, 40), (27, 6), (0, 6)], "T_BEAM", 564.0),
    ("flat", [(0, 0), (50, 0), (50, 6), (0, 6)], "RECTANGULAR_BAR", 300.0),
])
def test_structural_sections_cut_to_length(name, outline, form, area):
    out = extract(P.prism(P.polygon_face(outline), 600), [600, 60, 60])
    assert out["stock_form"] == form, name
    assert out["section"]["area_mm2"] == pytest.approx(area)
    assert out["developed_length_mm"] == pytest.approx(600.0)


def test_a_round_bar():
    out = extract(P.straight_tube(20, None, 300), [300, 20, 20])
    assert out["stock_form"] == "ROUND_BAR" and out["section"]["od_mm"] == pytest.approx(20.0, abs=0.01)


def test_end_forms():
    flare = extract(P.flared_tube(OD, WALL, 300, 10, 6), [310, 37, 37])
    assert [(f["end"], f["variant"]) for f in flare["forms"]] == [("end", "flare")]
    expand = extract(P.expanded_tube(OD, WALL, 300, 5, 30, 2), [335, 30, 30])
    assert [f["variant"] for f in expand["forms"]] == ["expansion"]
    ro, ri = OD / 2, OD / 2 - WALL
    flanged = extract(P.revolved_tube([(0, ri), (303, ri), (303, ro + 8), (300, ro + 8), (300, ro), (0, ro)]), [303, 41.4, 41.4])
    assert [f["variant"] for f in flanged["forms"]] == ["flange"]


def test_end_cuts():
    mitred = extract(P.mitre(P.straight_tube(OD, WALL, 400), 380, 30), [400, OD, OD])
    e = ends(mitred)
    assert (e["start"]["variant"], e["end"]["variant"]) == ("square", "angled")
    assert e["end"]["cut_angle_deg"] == pytest.approx(30.0, abs=0.01)
    # Cut to the tip of the mitre: 380 + the radius x tan 30.
    assert mitred["developed_length_mm"] == pytest.approx(380 + OD / 2 * math.tan(math.radians(30)), abs=0.05)
    notched = extract(P.cut_box(P.straight_tube(OD, WALL, 400), (390, -20, 5), (20, 40, 20)), [400, OD, OD])
    assert ends(notched)["end"]["variant"] == "notch" and notched["forms"] == []


def test_a_closed_ring():
    from OCC.Core.BRepBuilderAPI import BRepBuilderAPI_MakeEdge
    from OCC.Core.BRepOffsetAPI import BRepOffsetAPI_MakePipe
    from OCC.Core.gp import gp_Ax2, gp_Circ, gp_Dir, gp_Pnt

    path = P._wire([BRepBuilderAPI_MakeEdge(gp_Circ(gp_Ax2(gp_Pnt(0, 0, 0), gp_Dir(0, 0, 1)), 200)).Edge()])
    ring = BRepOffsetAPI_MakePipe(path, P.annulus_face(25, 2, at=(200, 0, 0), normal=(0, 1, 0))).Shape()
    out = extract(ring, [425, 425, 25])
    assert out["closed_ring"] and out["ends"] == []
    assert out["developed_length_mm"] == pytest.approx(2 * math.pi * 200, abs=0.05)
    assert "Ring" in {f["feature_type"] for f in out["feature_graph_v2"]["features"]}


def test_a_flat_part_is_cut_plate():
    out = extract(P.plate([(0, 0), (200, 0), (200, 80), (120, 150), (0, 150)], 6, holes=[(50, 50, 10), (150, 40, 12)]), [200, 150, 6])
    assert out["stock_form"] == "PLATE"
    p = out["plate"]
    assert p["thickness_mm"] == pytest.approx(6.0) and p["pierce_count"] == 2
    outline = 200 + 80 + math.hypot(80, 70) + 120 + 150
    assert p["cut_length_mm"] == pytest.approx(outline + math.pi * 10 + math.pi * 12, abs=0.05)
    assert (p["blank_length_mm"], p["blank_width_mm"]) == pytest.approx((200.0, 150.0))


def test_section_classifier_on_outlines():
    hexagon = [(10 * math.cos(math.radians(a)), 10 * math.sin(math.radians(a))) for a in range(0, 360, 60)]
    assert classify_section(hexagon)["stock_form"] == "HEX_BAR"
    i_beam = [(0, 0), (60, 0), (60, 6), (33, 6), (33, 74), (60, 74), (60, 80), (0, 80), (0, 74), (27, 74), (27, 6), (0, 6)]
    assert classify_section(i_beam)["stock_form"] == "I_BEAM"
    rect_tube = classify_section([(0, 0), (60, 0), (60, 30), (0, 30)], [[(3, 3), (57, 3), (57, 27), (3, 27)]])
    assert (rect_tube["stock_form"], rect_tube["wall_mm"]) == ("RECTANGULAR_TUBE", 3.0)
    zed = [(0, 0), (30, 0), (30, 5), (5, 5), (5, 45), (30, 45), (30, 50), (-25, 50), (-25, 45), (0, 45)]
    assert classify_section(zed)["stock_form"] == "GENERIC_EXTRUSION"


def test_the_family_hint_measures_a_bar_tube_part():
    from shared.memory_optimizer import AdvancedCADMemoryOptimizer
    from shared.part_family import BAR_TUBE

    mi = AdvancedCADMemoryOptimizer().analyze_and_optimize(P.straight_tube(OD, WALL, 300), family_hint=BAR_TUBE).geometry_features.manufacturing_features["manufacturing_intelligence"]
    assert mi["detected_family"] == BAR_TUBE
    assert mi["features"]["extraction_version"] == "bar-tube-1"
    assert mi["features"]["stock_form"] == "ROUND_TUBE"


def test_a_stepped_turned_shaft_is_not_bar_stock():
    out = extract(P.stepped_shaft(), [38, 20, 20])
    assert out["stock_form"] is None
    assert out["stock_fraction"] < 0.8
    assert "not one cross-section" in out["reason"]
