"""roto_blow.feature_extractor: a blow molded or rotomolded shell's wall, inside, spout, parting line and envelope, on OCC-built parts with known sizes."""
import math

import pytest

pytest.importorskip("OCC")

from OCC.Core.BRepAlgoAPI import BRepAlgoAPI_Cut, BRepAlgoAPI_Fuse  # noqa: E402
from OCC.Core.BRepPrimAPI import BRepPrimAPI_MakeBox, BRepPrimAPI_MakeCylinder  # noqa: E402
from OCC.Core.gp import gp_Ax2, gp_Dir, gp_Pnt  # noqa: E402

from roto_blow.feature_extractor import RotoBlowFeatureExtractor  # noqa: E402


def box(x, y, z, at=(0.0, 0.0, 0.0)):
    return BRepPrimAPI_MakeBox(gp_Pnt(*at), x, y, z).Shape()


def cylinder(r, h, at=(0.0, 0.0, 0.0)):
    return BRepPrimAPI_MakeCylinder(gp_Ax2(gp_Pnt(*at), gp_Dir(0, 0, 1)), r, h).Shape()


def cut(a, b):
    return BRepAlgoAPI_Cut(a, b).Shape()


def fuse(a, b):
    return BRepAlgoAPI_Fuse(a, b).Shape()


def bottle(wall=2.0):
    """A 80 mm round bottle 100 tall with a 24 mm neck 20 tall, walls `wall` thick, open at the neck."""
    outer = fuse(cylinder(40, 100), cylinder(12, 20, at=(0, 0, 100)))
    inner = fuse(cylinder(40 - wall, 100 - 2 * wall, at=(0, 0, wall)), cylinder(12 - wall, 30, at=(0, 0, 100 - wall - 1)))
    return cut(outer, inner)


def tank(opening):
    """A 300 x 200 x 150 tank, 4 mm walls, with `opening` cut through its top."""
    shell = cut(box(300, 200, 150), box(292, 192, 142, at=(4, 4, 4)))
    return cut(shell, opening)


def extract(shape, dims, pull=None):
    return RotoBlowFeatureExtractor().extract(shape, dims, pull_override=pull)


def test_a_bottle_holds_its_inside_and_is_blown_through_its_neck():
    out = extract(bottle(), [80, 80, 120], pull=(1.0, 0.0, 0.0))
    assert out["hollow"] is True
    inside = math.pi * 38 ** 2 * 96 + math.pi * 10 ** 2 * 22
    assert out["inside"]["volume_mm3"] == pytest.approx(inside, rel=0.2)
    assert out["wall"]["nominal_mm"] == pytest.approx(2.0, abs=0.3)
    assert [s["diameter_mm"] for s in out["spouts"]] == pytest.approx([20.0], abs=0.1)
    # Its round body is the inside's own wall, not a hole.
    assert all(h["diameter_mm"] < 40 for h in out["holes"])
    kinds = {f["feature_type"] for f in out["feature_graph_v2"]["features"]}
    assert "Spout" in kinds and "Perimeter" in kinds and "PartingLine" in kinds


def test_a_tank_is_filled_through_its_round_opening_and_measured_for_its_mold():
    out = extract(tank(cylinder(25, 20, at=(150, 100, 140))), [300, 200, 150], pull=(0.0, 0.0, 1.0))
    assert out["hollow"] is True
    assert out["inside"]["volume_mm3"] == pytest.approx(292 * 192 * 142, rel=0.1)
    assert [s["diameter_mm"] for s in out["spouts"]] == pytest.approx([50.0], abs=0.1)
    assert out["wall"]["nominal_mm"] == pytest.approx(4.0, abs=0.4)
    assert out["envelope_mm"] == pytest.approx({"length": 300.0, "width": 200.0, "depth": 150.0}, abs=0.5)
    # The parting line runs round the outline: 2 x (300 + 200).
    assert out["perimeter_mm"] == pytest.approx(1000.0, rel=0.01)
    assert out["feature_graph_v2"]["measurements"]["inside_volume"]["occurrences"][0]["face_ids"]


def test_a_square_cut_out_opens_the_inside_but_is_no_spout():
    out = extract(tank(box(60, 60, 20, at=(120, 70, 140))), [300, 200, 150], pull=(0.0, 0.0, 1.0))
    assert out["hollow"] is True and out["spouts"] == []
    assert out["inside"]["open_axis"] == "+z"


def test_a_solid_block_is_not_a_hollow_part():
    out = extract(box(100, 60, 40), [100, 60, 40])
    assert out["hollow"] is False and out["inside"] is None and out["spouts"] == []
