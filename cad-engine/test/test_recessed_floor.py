"""
A pocket floor is a planar face with a wall rising from it (machining/recessed_floor.py). Built on real OCC solids:
a closed pocket, an open step, a rib and a boss standing on a face, and a flat-bottomed hole.
"""
import pytest

pytest.importorskip("OCC.Core.BRepPrimAPI")

from OCC.Core.BRepAlgoAPI import BRepAlgoAPI_Cut, BRepAlgoAPI_Fuse  # noqa: E402
from OCC.Core.BRepPrimAPI import BRepPrimAPI_MakeBox, BRepPrimAPI_MakeCylinder  # noqa: E402
from OCC.Core.gp import gp_Ax2, gp_Dir, gp_Pnt  # noqa: E402

from machining.machining_feature_recognizer import (  # noqa: E402
    MachiningFeatureRecognizer, _part_bounding_box, build_machining_feature_graph_v2,
)

BLOCK = (60.0, 50.0, 20.0)


def _block():
    return BRepPrimAPI_MakeBox(*BLOCK).Shape()


def _box(x, y, z, dx, dy, dz):
    return BRepPrimAPI_MakeBox(gp_Pnt(x, y, z), dx, dy, dz).Shape()


def _recesses(shape):
    """The pocket, slot and keyway occurrences of the shape's feature graph."""
    tree = MachiningFeatureRecognizer().recognize(shape, "milled").to_dict()
    b = _part_bounding_box(shape)
    centre = ((b["xmin"] + b["xmax"]) / 2, (b["ymin"] + b["ymax"]) / 2, (b["zmin"] + b["zmax"]) / 2)
    graph = build_machining_feature_graph_v2(tree, centre, [], 0)
    return [(f["feature_type"], o) for f in graph["features"] if f["feature_type"] in ("PocketV2", "Slot", "Keyway")
            for o in f["occurrences"]]


def test_closed_pocket_has_its_depth_and_is_walled_all_round():
    part = BRepAlgoAPI_Cut(_block(), _box(20, 17.5, 12, 20, 15, 8)).Shape()
    [(ftype, occ)] = _recesses(part)
    assert ftype == "PocketV2"
    assert occ["depth_mm"] == pytest.approx(8.0, abs=0.01)
    assert occ["walled_fraction"] == pytest.approx(1.0, abs=0.01)
    assert occ["width_confined"] is True
    assert occ["material_removed_mm3"] == pytest.approx(20 * 15 * 8, rel=0.01)


def test_open_step_is_a_pocket_walled_on_one_side_however_long_it_is():
    # A 60 x 5 step along one edge: one wall, three open sides. Not a keyway.
    part = BRepAlgoAPI_Cut(_block(), _box(0, 0, 14, 60, 5, 6)).Shape()
    [(ftype, occ)] = _recesses(part)
    assert ftype == "PocketV2"
    assert occ["depth_mm"] == pytest.approx(6.0, abs=0.01)
    assert occ["walled_fraction"] < 0.5
    assert occ["width_confined"] is False


def test_channel_across_the_block_is_walled_on_both_long_sides():
    part = BRepAlgoAPI_Cut(_block(), _box(0, 22, 14, 60, 6, 6)).Shape()
    [(ftype, occ)] = _recesses(part)
    assert ftype == "Keyway"  # an elongated channel whose floor faces along the datum axis
    assert occ["width_confined"] is True


def test_rib_top_is_not_a_pocket():
    # A 0.8 mm rib standing on the block: its top is below the envelope only if something taller stands beside it.
    part = BRepAlgoAPI_Fuse(_block(), _box(10, 10, 20, 40, 0.8, 5)).Shape()
    part = BRepAlgoAPI_Fuse(part, _box(0, 40, 20, 60, 10, 9)).Shape()
    recesses = _recesses(part)
    # The only floor is the block's top face, from which the rib and the taller wall rise.
    assert [t for t, _o in recesses] == ["PocketV2"]
    assert recesses[0][1]["depth_mm"] == pytest.approx(9.0, abs=0.01)


def test_boss_top_is_not_a_pocket():
    boss = BRepPrimAPI_MakeCylinder(gp_Ax2(gp_Pnt(20, 20, 20), gp_Dir(0, 0, 1)), 4, 3).Shape()
    part = BRepAlgoAPI_Fuse(BRepAlgoAPI_Fuse(_block(), boss).Shape(), _box(0, 40, 20, 60, 10, 9)).Shape()
    recesses = _recesses(part)
    assert len(recesses) == 1 and recesses[0][1]["depth_mm"] == pytest.approx(9.0, abs=0.01)


def test_flat_bottom_of_a_hole_is_not_a_pocket():
    hole = BRepPrimAPI_MakeCylinder(gp_Ax2(gp_Pnt(30, 25, 10), gp_Dir(0, 0, 1)), 3, 10).Shape()
    part = BRepAlgoAPI_Cut(_block(), hole).Shape()
    assert _recesses(part) == []
    # Nor is it a face to finish: the only planar faces left are the block's own.
    tree = MachiningFeatureRecognizer().recognize(part, "milled").to_dict()
    hole = next(f for f in tree["features"] if f["type"] == "SimpleHole")
    planar = [i for f in tree["features"] if f["type"] == "PlanarFace" for i in f["face_ids"]]
    assert len(planar) == len(set(planar)) and len(planar) <= 6 and not set(planar) & set(hole["face_ids"])
