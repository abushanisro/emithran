import math

import pytest

pytest.importorskip("OCC")

from OCC.Core.BRepAlgoAPI import BRepAlgoAPI_Cut  # noqa: E402
from OCC.Core.BRepPrimAPI import BRepPrimAPI_MakeBox, BRepPrimAPI_MakeCylinder  # noqa: E402
from OCC.Core.gp import gp_Ax2, gp_Dir, gp_Pnt  # noqa: E402

from shared.solid_measures import measure_solid  # noqa: E402


def test_box_volume_area_and_sorted_extents():
    m = measure_solid(BRepPrimAPI_MakeBox(20.0, 50.0, 40.0).Shape())
    assert m["volume"] == pytest.approx(40_000.0, rel=1e-9)
    assert m["surface_area"] == pytest.approx(2 * (20 * 50 + 20 * 40 + 50 * 40), rel=1e-9)
    # Sorted length >= width >= height, whatever the STEP axes.
    assert [m["bounding_box"][k] for k in ("length", "width", "height")] == [50.0, 40.0, 20.0]


def test_a_through_hole_takes_its_volume_and_adds_its_wall():
    box = BRepPrimAPI_MakeBox(50.0, 40.0, 20.0).Shape()
    hole = BRepPrimAPI_MakeCylinder(gp_Ax2(gp_Pnt(25, 20, -1), gp_Dir(0, 0, 1)), 5.0, 22.0).Shape()
    m = measure_solid(BRepAlgoAPI_Cut(box, hole).Shape())
    assert m["volume"] == pytest.approx(50 * 40 * 20 - math.pi * 25 * 20, rel=1e-6)
    assert m["surface_area"] == pytest.approx(2 * (50 * 40 + 50 * 20 + 40 * 20) - 2 * math.pi * 25 + 2 * math.pi * 5 * 20, rel=1e-6)
    assert m["bounding_box"]["length"] == 50.0
