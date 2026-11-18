"""family_hint two_model: a 2-Model Machining part is analysed as the machined part it is (its blank is derived from it by the backend)."""
import pytest

pytest.importorskip("OCC")

from OCC.Core.BRepPrimAPI import BRepPrimAPI_MakeBox  # noqa: E402
from OCC.Core.gp import gp_Pnt  # noqa: E402


def box(x, y, z):
    return BRepPrimAPI_MakeBox(gp_Pnt(0.0, 0.0, 0.0), x, y, z).Shape()


def test_a_two_model_part_is_analysed_as_a_machined_part_whatever_the_geometry_alone_reads():
    # A 2 mm plate reads as sheet metal by its geometry; as a 2-Model part it is machined (milled), with the geometry's verdict beside it.
    from shared.memory_optimizer import AdvancedCADMemoryOptimizer
    from shared.part_family import MACHINING_FAMILIES, MILLED, TWO_MODEL_HINT

    plate = box(200, 150, 2)
    mi = AdvancedCADMemoryOptimizer().analyze_and_optimize(plate, family_hint=TWO_MODEL_HINT).geometry_features.manufacturing_features["manufacturing_intelligence"]
    assert mi["detected_family"] in MACHINING_FAMILIES
    if mi["geometric_family"] not in MACHINING_FAMILIES:
        assert mi["detected_family"] == MILLED
    # A block that the geometry already reads as machined keeps that family.
    block = box(60, 50, 40)
    mi = AdvancedCADMemoryOptimizer().analyze_and_optimize(block, family_hint=TWO_MODEL_HINT).geometry_features.manufacturing_features["manufacturing_intelligence"]
    assert mi["detected_family"] in MACHINING_FAMILIES
