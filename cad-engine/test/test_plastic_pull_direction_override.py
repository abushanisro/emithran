"""
The engineer's mold-opening axis reaches the analysis: validated at the endpoint, part of the cache key (another axis is another analysis), and
carried through to the plastic recognition.

Run: docker compose -f docker-compose.dev.yml --profile test run --rm tests pytest test/test_plastic_pull_direction_override.py
"""
import pytest
from fastapi import HTTPException
from OCC.Core.BRepPrimAPI import BRepPrimAPI_MakeBox
from OCC.Core.gp import gp_Pnt

from main import _pull_axis_vector
from shared.memory_optimizer import AdvancedCADMemoryOptimizer


@pytest.mark.parametrize("raw,vec", [("x", (1.0, 0.0, 0.0)), (" Y ", (0.0, 1.0, 0.0)), ("z", (0.0, 0.0, 1.0)), ("", None)])
def test_axis_parsed(raw, vec):
    assert _pull_axis_vector(raw) == vec


@pytest.mark.parametrize("raw", ["w", "1,0,0", "xy"])
def test_anything_else_is_refused_not_guessed(raw):
    with pytest.raises(HTTPException) as e:
        _pull_axis_vector(raw)
    assert e.value.status_code == 422


def test_another_axis_is_another_cache_entry():
    shape = BRepPrimAPI_MakeBox(gp_Pnt(0, 0, 0), 10, 20, 30).Shape()
    opt = AdvancedCADMemoryOptimizer.__new__(AdvancedCADMemoryOptimizer)
    h = lambda pull: opt._calculate_geometry_hash(shape, None, "abc", "", pull)
    auto, x, z = h(None), h((1.0, 0.0, 0.0)), h((0.0, 0.0, 1.0))
    assert len({auto, x, z}) == 3
    assert h((0.0, 0.0, 1.0)) == z  # stable
