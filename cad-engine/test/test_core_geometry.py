import math

import pytest

pytest.importorskip("OCC")

from OCC.Core.BRepAlgoAPI import BRepAlgoAPI_Cut  # noqa: E402
from OCC.Core.BRepPrimAPI import BRepPrimAPI_MakeBox, BRepPrimAPI_MakeCylinder  # noqa: E402
from OCC.Core.gp import gp_Ax2, gp_Dir, gp_Pnt  # noqa: E402

from shared.core_geometry import trapped_cores  # noqa: E402

Z = [0, 0, 1]


def _box(x, y, z, at=(0, 0, 0)):
    return BRepPrimAPI_MakeBox(gp_Pnt(*at), x, y, z).Shape()


def test_plain_block_has_no_core():
    r = trapped_cores(_box(60, 40, 20), Z)
    assert r["core_count"] == 0
    assert r["skipped_columns"] == 0


def test_blind_pocket_open_to_a_die_half_is_not_a_core():
    part = BRepAlgoAPI_Cut(_box(60, 40, 20), _box(20, 20, 10, at=(20, 10, 10))).Shape()
    assert trapped_cores(part, Z)["core_count"] == 0


def test_enclosed_cavity_is_one_core_of_its_volume():
    part = BRepAlgoAPI_Cut(_box(60, 40, 30), _box(20, 20, 10, at=(20, 10, 10))).Shape()
    r = trapped_cores(part, Z)
    assert r["core_count"] == 1
    core = r["cores"][0]
    h = r["cell_mm"]
    # Column model: the width is exact to within one grid cell (h, set by
    # voxelCount); along the pull it is exact.
    assert (20 - h) ** 2 * 10 <= core["volume_mm3"] <= (20 + h) ** 2 * 10
    assert core["box_mm"][0] == pytest.approx(20, abs=h)
    assert core["box_mm"][1] == pytest.approx(20, abs=h)
    assert core["box_mm"][2] == pytest.approx(10, abs=1e-3)
    w = lambda d: 2 * (d * d + d * 10 + d * 10)  # noqa: E731
    assert w(20 - h) <= core["area_mm2"] <= w(20 + h)


def test_hole_across_the_pull_is_a_core():
    hole = BRepPrimAPI_MakeCylinder(gp_Ax2(gp_Pnt(-1, 20, 10), gp_Dir(1, 0, 0)), 5.0, 62.0).Shape()
    part = BRepAlgoAPI_Cut(_box(60, 40, 20), hole).Shape()
    r = trapped_cores(part, Z)
    assert r["core_count"] == 1
    assert r["cores"][0]["volume_mm3"] == pytest.approx(math.pi * 25 * 60, rel=0.08)
    # Along the pull the same hole is open to both halves: no core.
    assert trapped_cores(part, [1, 0, 0])["core_count"] == 0


def test_two_separate_side_holes_are_two_cores():
    a = BRepPrimAPI_MakeCylinder(gp_Ax2(gp_Pnt(-1, 10, 10), gp_Dir(1, 0, 0)), 4.0, 62.0).Shape()
    b = BRepPrimAPI_MakeCylinder(gp_Ax2(gp_Pnt(-1, 30, 10), gp_Dir(1, 0, 0)), 4.0, 62.0).Shape()
    part = BRepAlgoAPI_Cut(BRepAlgoAPI_Cut(_box(60, 40, 20), a).Shape(), b).Shape()
    r = trapped_cores(part, Z)
    assert r["core_count"] == 2
    for c in r["cores"]:
        assert c["volume_mm3"] == pytest.approx(math.pi * 16 * 60, rel=0.1)
