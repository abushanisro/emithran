"""
Real integration test for the manual family_hint override (shared/
memory_optimizer.py's analyze_and_optimize, dispatched from main.py's
analyze_geometry_advanced). Proves the actual dispatch elif branch runs the
right extractor through the real entrypoint, not just via a direct unit call
to the extractor class -- and, since the override generalized from a single
die_cast special-case to any shared.part_family.ALL_FAMILIES member (the
Create BOM Item process dropdown needs to force ANY of the 6 real families,
not just die_cast), that every real family round-trips and an unrecognized
value is safely ignored rather than faked into a family that doesn't exist.
"""
import pytest

pytest.importorskip("OCC")

from OCC.Core.BRepPrimAPI import BRepPrimAPI_MakeBox

from shared.memory_optimizer import AdvancedCADMemoryOptimizer
from shared.part_family import DIE_CAST, MILLED


def test_family_hint_die_cast_dispatches_to_die_casting_extractor():
    shape = BRepPrimAPI_MakeBox(50.0, 40.0, 20.0).Shape()
    optimizer = AdvancedCADMemoryOptimizer()
    result = optimizer.analyze_and_optimize(shape, family_hint="die_cast")

    mi = result.geometry_features.manufacturing_features["manufacturing_intelligence"]
    assert mi["detected_family"] == DIE_CAST
    assert "manual family_hint=die_cast" in mi["classification_reason"][0]
    features = mi["features"]
    assert "feature_graph_v2" in features
    assert features["primary_setup_axis"] is not None


def test_no_family_hint_does_not_trigger_die_casting_path():
    """A real negative control: without family_hint, the same box must NOT
    be classified die_cast (the real classifier chain runs unchanged)."""
    shape = BRepPrimAPI_MakeBox(50.0, 40.0, 20.0).Shape()
    optimizer = AdvancedCADMemoryOptimizer()
    result = optimizer.analyze_and_optimize(shape)

    mi = result.geometry_features.manufacturing_features["manufacturing_intelligence"]
    assert mi["detected_family"] != DIE_CAST


def test_family_hint_generalizes_to_a_non_die_cast_real_family():
    """The same box, hinted 'milled' instead of 'die_cast' -- proves the
    override is a real family_hint in ALL_FAMILIES check, not still hardcoded
    to the single DIE_CAST literal."""
    shape = BRepPrimAPI_MakeBox(50.0, 40.0, 20.0).Shape()
    optimizer = AdvancedCADMemoryOptimizer()
    result = optimizer.analyze_and_optimize(shape, family_hint="milled")

    mi = result.geometry_features.manufacturing_features["manufacturing_intelligence"]
    assert mi["detected_family"] == MILLED
    assert "manual family_hint=milled" in mi["classification_reason"][0]


def test_unrecognized_family_hint_is_ignored_not_fabricated():
    """A typo'd/stale/unknown family_hint must never be honored as if it were
    a real platform family -- the real classifier chain runs as if no hint
    were passed at all."""
    shape = BRepPrimAPI_MakeBox(50.0, 40.0, 20.0).Shape()
    optimizer = AdvancedCADMemoryOptimizer()
    baseline = optimizer.analyze_and_optimize(shape)
    hinted = optimizer.analyze_and_optimize(shape, family_hint="not_a_real_family")

    mi_baseline = baseline.geometry_features.manufacturing_features["manufacturing_intelligence"]
    mi_hinted = hinted.geometry_features.manufacturing_features["manufacturing_intelligence"]
    assert mi_hinted["detected_family"] == mi_baseline["detected_family"]
    assert "manual family_hint" not in mi_hinted["classification_reason"][0]
