"""additive.voids and the additive holes: the pockets, ring pockets, cavities and holes cleaning clears, on OCC-built parts with known sizes."""
import pytest

pytest.importorskip("OCC")

from OCC.Core.BRepAlgoAPI import BRepAlgoAPI_Cut, BRepAlgoAPI_Fuse  # noqa: E402
from OCC.Core.BRepPrimAPI import BRepPrimAPI_MakeBox, BRepPrimAPI_MakeCylinder  # noqa: E402
from OCC.Core.gp import gp_Ax2, gp_Dir, gp_Pnt  # noqa: E402

from additive.feature_extractor import AdditiveFeatureExtractor  # noqa: E402


def box(x, y, z, at=(0.0, 0.0, 0.0)):
    return BRepPrimAPI_MakeBox(gp_Pnt(*at), x, y, z).Shape()


def cylinder(r, h, at=(0.0, 0.0, 0.0)):
    return BRepPrimAPI_MakeCylinder(gp_Ax2(gp_Pnt(*at), gp_Dir(0, 0, 1)), r, h).Shape()


def cut(a, b):
    return BRepAlgoAPI_Cut(a, b).Shape()


def fuse(a, b):
    return BRepAlgoAPI_Fuse(a, b).Shape()


def extract(shape, dims):
    return AdditiveFeatureExtractor().extract(shape, dims)


def voids_of(out, ftype):
    return [v for v in out["voids"] if v["feature_type"] == ftype]


def test_a_plain_block_has_no_void():
    out = extract(box(40, 30, 20), [40, 30, 20])
    assert out["voids"] == []


def test_a_pocket_is_a_simple_void_with_its_volume_and_depth():
    # 40 x 30 x 20 block with a 20 x 10 x 8 pocket from the top.
    out = extract(cut(box(40, 30, 20), box(20, 10, 8, at=(10, 10, 12))), [40, 30, 20])
    pockets = voids_of(out, "Void")
    assert len(pockets) == 1
    v = pockets[0]
    assert v["variant"] == "simple"
    cell = out["void_cell_mm"]
    assert v["volume_mm3"] == pytest.approx(20 * 10 * 8, rel=0.25)
    assert v["depth_mm"] == pytest.approx(8.0, abs=1.5 * cell)
    assert v["open_axis"] == "+z"
    assert v["face_ids"], "the pocket's faces are named for the highlight"
    assert any(f["feature_type"] == "Void" and f["variant"] == "simple" for f in out["feature_graph_v2"]["features"])


def test_a_pocket_around_a_boss_is_a_ring():
    # A 24 mm diameter pocket 10 deep with a 10 mm boss standing to the top in its middle.
    body = cut(box(40, 40, 20), cylinder(12, 10, at=(20, 20, 10)))
    body = fuse(body, cylinder(5, 10, at=(20, 20, 10)))
    out = extract(body, [40, 40, 20])
    rings = voids_of(out, "Ring")
    assert len(rings) == 1
    import math
    assert rings[0]["volume_mm3"] == pytest.approx(math.pi * (12 ** 2 - 5 ** 2) * 10, rel=0.25)
    assert rings[0]["depth_mm"] == pytest.approx(10.0, abs=1.5 * out["void_cell_mm"])


def test_an_enclosed_cavity_is_a_complex_void():
    out = extract(cut(box(30, 30, 30), box(10, 10, 10, at=(10, 10, 10))), [30, 30, 30])
    v = voids_of(out, "Void")
    assert len(v) == 1 and v[0]["variant"] == "complex" and v[0]["open_axis"] is None
    assert v[0]["volume_mm3"] == pytest.approx(1000.0, rel=0.3)


def test_a_square_through_hole_is_a_complex_hole_with_its_equivalent_diameter():
    out = extract(cut(box(40, 40, 15), box(10, 10, 15, at=(15, 15, 0))), [40, 40, 15])
    holes = voids_of(out, "ComplexHole")
    assert len(holes) == 1
    # 4 x area / perimeter of a 10 mm square is 10 mm.
    assert holes[0]["equivalent_diameter_mm"] == pytest.approx(10.0, rel=0.2)
    assert holes[0]["depth_mm"] == pytest.approx(15.0, abs=1.5 * out["void_cell_mm"])


def test_a_round_hole_is_a_hole_not_a_void():
    out = extract(cut(box(40, 40, 15), cylinder(4, 15, at=(20, 20, 0))), [40, 40, 15])
    assert out["voids"] == []
    assert [h["feature_type"] for h in out["holes"]] == ["SimpleHole"]
    assert out["holes"][0]["diameter_mm"] == pytest.approx(8.0, abs=0.05)


def test_a_bore_with_a_groove_inside_is_a_ringed_hole():
    # A 6 mm through bore with a 10 mm, 2 mm wide groove at mid depth.
    body = cut(cut(box(30, 30, 20), cylinder(3, 20, at=(15, 15, 0))), cylinder(5, 2, at=(15, 15, 9)))
    out = extract(body, [30, 30, 20])
    ringed = [h for h in out["holes"] if h["feature_type"] == "RingedHole"]
    assert len(ringed) == 1
    assert ringed[0]["diameter_mm"] == pytest.approx(6.0, abs=0.05)
    assert ringed[0]["depth_mm"] == pytest.approx(20.0, abs=0.05)
    assert any(f["feature_type"] == "RingedHole" for f in out["feature_graph_v2"]["features"])
    assert voids_of(out, "Ring") == [] and voids_of(out, "Void") == []


def test_an_open_slot_is_not_a_void():
    # A slot across the whole top: open on top and at both ends, cleared with the part.
    out = extract(cut(box(40, 30, 20), box(40, 10, 8, at=(0, 10, 12))), [40, 30, 20])
    assert out["voids"] == []
