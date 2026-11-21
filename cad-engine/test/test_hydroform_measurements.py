"""
sheet_metal/features/hydroform.py: what a hydroformed sheet part is measured for, on OCC-built parts with known sizes, through the full
production extract() (the "hydroform" key every sheet part carries):

  - a round drawn cup (D80 x 50, t 1): depth, opening width, developed area and its equal-area blank, an exact circle
  - the same cup with a 6 mm hole through its wall: the hole is measured (not pierced in the flat) and is not part of the drawn form
  - a 200 x 100 plate with two 90 deg straight flanges 30 high: depth = flange height, two straight flanges, the unfolded blank
  - a half cup: a flange following the main face's curved edge (curved flange), no drawn form
  - a plate with holes 2 mm and 10 mm from its edge, a slot and a rectangular cut-out
  - a flat plate: depth = thickness, no flange, the flat blank
"""
import math

import pytest

pytest.importorskip("OCC")

from OCC.Core.BRepAlgoAPI import BRepAlgoAPI_Cut  # noqa: E402
from OCC.Core.BRepBuilderAPI import BRepBuilderAPI_MakeEdge, BRepBuilderAPI_MakeFace, BRepBuilderAPI_MakeWire  # noqa: E402
from OCC.Core.BRepPrimAPI import BRepPrimAPI_MakeBox, BRepPrimAPI_MakeCylinder, BRepPrimAPI_MakePrism  # noqa: E402
from OCC.Core.GC import GC_MakeArcOfCircle  # noqa: E402
from OCC.Core.gp import gp_Ax2, gp_Dir, gp_Pnt, gp_Vec  # noqa: E402

from sheet_metal.features.drawn_shell import _face_records, _twin_partners, _twins, detect_drawn_shell  # noqa: E402
from test_bend_relationships import make_bent_sheet  # noqa: E402
from test_drawn_shell import _box, _cup, _drawn, _extract  # noqa: E402

CUP_T = 1.0


def cut(a, b):
    c = BRepAlgoAPI_Cut(a, b)
    c.Build()
    return c.Shape()


def cylinder(r, h, at, axis=(0, 0, 1)):
    return BRepPrimAPI_MakeCylinder(gp_Ax2(gp_Pnt(*at), gp_Dir(*axis)), r, h).Shape()


def cup_with_wall_hole():
    """The D80 cup with a 6 mm hole through its +Y wall at mid height."""
    return cut(_cup(), cylinder(3.0, 20.0, (0.0, 30.0, 25.0), axis=(0, 1, 0)))


def channel(length=200.0, width=100.0, height=30.0, t=2.0, r=3.0):
    """A plate `length` x `width` with a 90 deg flange `height` high (outside) along each `width` edge: the U profile (inner bend
    radius r, thickness t) drawn with three-point arcs and extruded `width` along Y."""
    ro = r + t

    def p(x, z):
        return gp_Pnt(x, 0, z)

    def arc(c, rad, a0, a1):
        pts = [p(c[0] + rad * math.cos(a), c[1] + rad * math.sin(a)) for a in (a0, (a0 + a1) / 2, a1)]
        return BRepBuilderAPI_MakeEdge(GC_MakeArcOfCircle(*pts).Value()).Edge()

    def line(a, b):
        return BRepBuilderAPI_MakeEdge(p(*a), p(*b)).Edge()

    cl, cr = (ro, ro), (length - ro, ro)
    edges = [
        line((0, height), (0, ro)), arc(cl, ro, math.pi, 1.5 * math.pi), line((ro, 0), (length - ro, 0)),
        arc(cr, ro, 1.5 * math.pi, 2 * math.pi), line((length, ro), (length, height)), line((length, height), (length - t, height)),
        line((length - t, height), (length - t, ro)), arc(cr, r, 0.0, -0.5 * math.pi), line((length - ro, t), (ro, t)),
        arc(cl, r, -0.5 * math.pi, -math.pi), line((t, ro), (t, height)), line((t, height), (0, height)),
    ]
    wire = BRepBuilderAPI_MakeWire()
    for e in edges:
        wire.Add(e)
    return BRepPrimAPI_MakePrism(BRepBuilderAPI_MakeFace(wire.Wire()).Face(), gp_Vec(0, width, 0)).Shape()


def half_cup():
    """A D80 x 12 drawn cup (t 1, 5 mm bottom radius) cut in half: a half-disc plate whose curved edge carries a 90 deg flange."""
    cup = _drawn(cylinder(40.0, 12.0, (0.0, 0.0, 0.0)), 5, CUP_T, 12)
    return cut(cup, BRepPrimAPI_MakeBox(gp_Pnt(-50, -50, -5), 100, 50, 30).Shape())


def plate_with_cutouts():
    """200 x 100 x 2: a 10 mm hole 2 mm from the x = 0 edge, an 8 mm hole 10 mm from the y = 100 edge, a 30 x 6 slot and a 20 x 15
    rectangular cut-out."""
    plate = BRepPrimAPI_MakeBox(200, 100, 2).Shape()
    plate = cut(plate, cylinder(5.0, 4.0, (7.0, 50.0, -1.0)))
    plate = cut(plate, cylinder(4.0, 4.0, (100.0, 86.0, -1.0)))
    slot = BRepPrimAPI_MakeBox(gp_Pnt(60, 20, -1), 24, 6, 4).Shape()
    slot = cut(plate, slot)
    slot = cut(slot, cylinder(3.0, 4.0, (60.0, 23.0, -1.0)))
    slot = cut(slot, cylinder(3.0, 4.0, (84.0, 23.0, -1.0)))
    return cut(slot, BRepPrimAPI_MakeBox(gp_Pnt(140, 30, -1), 20, 15, 4).Shape())


def _hf(shape):
    result = _extract(shape)
    return result, result["hydroform"]


# ── the drawn cup ───────────────────────────────────────────────────────────

def test_round_cup_depth_width_areas_and_its_equal_area_blank():
    result, hf = _hf(_cup())
    assert hf["version"] == "hf_v1"
    assert [abs(c) for c in hf["normal"]] == [0.0, 0.0, 1.0]
    assert hf["forming_depth_mm"] == pytest.approx(50.0, abs=0.05)
    assert hf["plan"]["length_mm"] == pytest.approx(80.0, rel=0.002)
    assert hf["plan"]["min_width_mm"] == pytest.approx(80.0, rel=0.002)
    assert hf["projected_area_mm2"] == pytest.approx(math.pi * 40 ** 2, rel=0.005)
    # The bottom disc (radius 40 - 6 of the outer skin) is the main face.
    assert hf["main_surface"]["area_mm2"] == pytest.approx(math.pi * 34 ** 2, rel=0.001)
    assert hf["main_surface"]["perimeter_mm"] == pytest.approx(2 * math.pi * 34, rel=0.001)

    drawn = hf["drawn"]
    assert drawn["depth_mm"] == pytest.approx(50.0, abs=0.1)
    assert drawn["opening_width_mm"] == pytest.approx(80.0, rel=0.002)
    assert drawn["form_projected_area_mm2"] == pytest.approx(math.pi * 40 ** 2, rel=0.005)
    # The form is the wall and the bottom radius: everything but the bottom disc.
    assert drawn["form_developed_area_mm2"] == pytest.approx(hf["developed_area_mm2"] - math.pi * 34 ** 2, rel=0.001)

    # Mid-surface: bottom disc r 34, a quarter torus (major 34, tube 5.5) and the wall (r 39.5, 44 high).
    mid = math.pi * 34 ** 2 + 2 * math.pi * 5.5 * (34 * math.pi / 2 + 5.5) + 2 * math.pi * 39.5 * 44
    assert hf["developed_area_mm2"] == pytest.approx(mid, rel=0.002)

    blank = hf["blank"]
    assert blank["method"] == "drawn_equal_area"
    assert blank["area_mm2"] == pytest.approx(hf["developed_area_mm2"], rel=0.005)
    d0 = math.sqrt(4 * blank["area_mm2"] / math.pi)
    assert blank["circumscribed_diameter_mm"] == pytest.approx(d0, rel=0.005)
    assert blank["length_mm"] == pytest.approx(d0, rel=0.005) and blank["width_mm"] == pytest.approx(d0, rel=0.005)
    assert blank["perimeter_mm"] == pytest.approx(math.pi * d0, rel=0.005)
    pts = blank["outline_points_mm"]
    assert pts[0] == pts[-1] and len(pts) > 100
    assert blank["pierced_hole_area_mm2"] == 0 and blank["pierced_hole_perimeter_mm"] == 0
    # The bottom radius runs all the way round the main face: the drawn form, not a curved flange.
    assert hf["flanges"] == []
    assert hf["holes"] == []
    assert result["flat_pattern_area_mm2"] == pytest.approx(hf["developed_area_mm2"], abs=0.1)


def test_a_hole_through_the_drawn_wall_is_measured_not_swallowed():
    shape = cup_with_wall_hole()
    result, hf = _hf(shape)
    shell = detect_drawn_shell(shape, CUP_T, (0.0, 0.0, 1.0))
    assert len(hf["holes"]) == 1
    hole = hf["holes"][0]
    assert hole["feature_type"] == "SimpleHole"
    assert hole["diameter_mm"] == pytest.approx(6.0, abs=0.01)
    assert hole["area_mm2"] == pytest.approx(math.pi * 9, rel=0.005)
    assert hole["perimeter_mm"] == pytest.approx(6 * math.pi, rel=0.005)
    assert hole["in_flat"] is False  # through the drawn wall: not pierced in the flat blank
    assert hole["on_main_surface"] is False and hole["edge_distance_mm"] is None
    # Its bore crosses the sheet (no offset twin): it is not part of the drawn region.
    assert not set(hole["face_ids"]) & set(shell["face_ids"])
    assert len(shell["face_ids"]) == len(detect_drawn_shell(_cup(), CUP_T, (0.0, 0.0, 1.0))["face_ids"])
    assert hf["drawn"]["opening_width_mm"] == pytest.approx(80.0, rel=0.002)
    assert hf["blank"]["pierced_hole_area_mm2"] == 0
    # The blank encloses the sheet the hole is cut from: the same blank as the cup without it.
    plain = _hf(_cup())[1]["blank"]["circumscribed_diameter_mm"]
    assert hf["blank"]["circumscribed_diameter_mm"] == pytest.approx(plain, abs=0.05)
    assert result["rolled_form_count"] == 0


def test_a_drawn_box_is_one_form_with_no_flange():
    _result, hf = _hf(_box())
    assert hf["drawn"]["depth_mm"] == pytest.approx(30.0, abs=0.1)
    assert hf["drawn"]["opening_width_mm"] == pytest.approx(80.0, abs=0.1)
    assert hf["plan"]["length_mm"] == pytest.approx(120.0, abs=0.1) and hf["plan"]["width_mm"] == pytest.approx(80.0, abs=0.1)
    assert hf["flanges"] == []
    blank = hf["blank"]
    assert blank["method"] == "drawn_equal_area"
    # The box's own outline scaled about its centroid to the developed area: the 120 x 80 aspect is kept.
    assert blank["length_mm"] / blank["width_mm"] == pytest.approx(1.5, rel=0.005)
    assert blank["length_mm"] * blank["width_mm"] > hf["developed_area_mm2"]


# ── flanges ─────────────────────────────────────────────────────────────────

def test_a_plate_with_two_straight_flanges():
    result, hf = _hf(channel())
    assert hf["forming_depth_mm"] == pytest.approx(30.0, abs=0.05)  # the flange height
    assert hf["plan"]["length_mm"] == pytest.approx(200.0, abs=0.05) and hf["plan"]["width_mm"] == pytest.approx(100.0, abs=0.05)
    assert hf["drawn"] is None
    assert hf["main_surface"]["area_mm2"] == pytest.approx(190 * 100, abs=0.5)
    flanges = hf["flanges"]
    assert [f["kind"] for f in flanges] == ["straight", "straight"]
    for f in flanges:
        assert f["angle_deg"] == pytest.approx(90.0, abs=0.01)
        assert f["length_mm"] == pytest.approx(100.0, abs=0.01)
        assert f["height_mm"] == pytest.approx(30.0 - 5.0, abs=0.01)  # the straight leg beyond the 3 + 2 mm bend
        assert f["edge_radius_mm"] is None and len(f["face_ids"]) == 2
    blank = hf["blank"]
    assert blank["method"] == "true_unfold"
    assert blank["area_mm2"] == pytest.approx(result["flat_pattern_area_mm2"], abs=0.1)
    assert blank["width_mm"] == pytest.approx(100.0, abs=0.5)
    assert blank["length_mm"] > 240.0
    assert hf["holes"] == []


def test_a_flange_following_a_curved_edge_is_a_curved_flange_not_a_form():
    _result, hf = _hf(half_cup())
    assert hf["drawn"] is None
    assert hf["forming_depth_mm"] == pytest.approx(12.0, abs=0.05)
    [flange] = hf["flanges"]
    assert flange["kind"] == "curved"
    assert flange["edge_radius_mm"] == pytest.approx(35.0, abs=0.01)
    assert flange["length_mm"] == pytest.approx(math.pi * 35.0, rel=0.001)  # the half circle it follows
    assert flange["angle_deg"] == pytest.approx(90.0, abs=0.01)
    assert flange["height_mm"] == pytest.approx(12.0 - 5.0, abs=0.01)
    assert hf["blank"]["method"] == "drawn_equal_area"  # double-curved sheet cannot be unfolded


# ── holes and the flat blank ────────────────────────────────────────────────

def test_holes_near_the_edge_slots_and_cut_outs():
    _result, hf = _hf(plate_with_cutouts())
    holes = hf["holes"]
    simple = sorted((h for h in holes if h["feature_type"] == "SimpleHole"), key=lambda h: h["diameter_mm"])
    assert [h["diameter_mm"] for h in simple] == [8.0, 10.0]
    assert simple[1]["edge_distance_mm"] == pytest.approx(2.0, abs=0.01)
    assert simple[0]["edge_distance_mm"] == pytest.approx(10.0, abs=0.01)
    assert simple[1]["area_mm2"] == pytest.approx(math.pi * 25, abs=0.05)
    assert simple[1]["perimeter_mm"] == pytest.approx(10 * math.pi, abs=0.01)
    assert all(h["in_flat"] and h["on_main_surface"] for h in holes)
    [slot] = [h for h in holes if h["feature_type"] == "Slot"]
    assert slot["diameter_mm"] is None
    assert slot["area_mm2"] == pytest.approx(24 * 6 + math.pi * 9, rel=0.005)
    assert slot["perimeter_mm"] == pytest.approx(2 * 24 + 6 * math.pi, rel=0.005)
    [other] = [h for h in holes if h["feature_type"] == "ComplexHole"]
    assert other["area_mm2"] == pytest.approx(300.0, rel=0.001) and other["perimeter_mm"] == pytest.approx(70.0, abs=0.01)
    assert other["edge_distance_mm"] == pytest.approx(30.0, abs=0.01)  # its y = 30 side to the y = 0 edge
    blank = hf["blank"]
    assert blank["method"] == "flat"
    assert blank["pierced_hole_area_mm2"] == pytest.approx(sum(h["area_mm2"] for h in holes), abs=0.2)
    assert blank["pierced_hole_perimeter_mm"] == pytest.approx(sum(h["perimeter_mm"] for h in holes), abs=0.05)
    # The blank's area has the holes cut; its outline encloses them.
    assert blank["area_mm2"] == pytest.approx(20000.0 - blank["pierced_hole_area_mm2"], abs=1.0)
    assert blank["perimeter_mm"] == pytest.approx(600.0, abs=0.01)


def test_a_flat_plate():
    _result, hf = _hf(BRepPrimAPI_MakeBox(100, 60, 2).Shape())
    assert hf["forming_depth_mm"] == pytest.approx(2.0, abs=0.01)  # the thickness
    assert hf["flanges"] == [] and hf["holes"] == [] and hf["drawn"] is None
    assert hf["developed_area_mm2"] == pytest.approx(6000.0, abs=0.1)
    assert hf["projected_area_mm2"] == pytest.approx(6000.0, abs=0.1)
    blank = hf["blank"]
    assert blank["method"] == "flat"
    assert blank["area_mm2"] == pytest.approx(6000.0, abs=0.1)
    assert (blank["length_mm"], blank["width_mm"], blank["perimeter_mm"]) == (100.0, 60.0, 320.0)
    assert blank["circumscribed_diameter_mm"] == pytest.approx(math.hypot(100, 60), abs=0.01)


# ── the shared face analysis ────────────────────────────────────────────────

@pytest.mark.parametrize("shape, t", [
    (_cup(), 1.0), (_box(), 1.2), (channel(), 2.0), (make_bent_sheet([30.0, 20.0, 30.0], [90.0, 90.0]), 2.0),
])
def test_the_twin_search_finds_exactly_the_pairs_the_pairwise_test_does(shape, t):
    records = _face_records(shape)
    pairwise = {(a["index"], b["index"]) for i, a in enumerate(records) for b in records[i + 1:] if _twins(a, b, t)}
    found = {(a, b) for a, bs in _twin_partners(records, t).items() for b in bs if a < b}
    assert found == pairwise and pairwise
