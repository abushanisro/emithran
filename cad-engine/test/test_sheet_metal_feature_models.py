"""
The sheet-metal feature vocabulary gate (sheet_metal/feature_models.py): every
feature_graph_v2 entry must be a reference sheet-metal catalog type
(shared/reference_features.json) with a variant defined for that type.
"""
import pytest

from shared.feature_vocabulary import feature_types, operations_for
from sheet_metal.feature_models import VARIANTS, sheet_metal_feature


def test_builds_an_entry_with_type_variant_and_extra_fields():
    entry = sheet_metal_feature("hole_d5.0", "SimpleHole", "through", diameter_mm=5.0, occurrences=[])
    assert entry == {
        "id": "hole_d5.0", "feature_type": "SimpleHole", "variant": "through",
        "diameter_mm": 5.0, "occurrences": [],
    }


def test_rejects_a_type_outside_the_sheet_metal_catalog():
    with pytest.raises(ValueError, match="not a reference sheet_metal feature type"):
        sheet_metal_feature("x", "hole", "through")


def test_rejects_a_machining_only_type():
    # PocketV2 is a real machining catalog type but not a sheet-metal one.
    with pytest.raises(ValueError, match="not a reference sheet_metal feature type"):
        sheet_metal_feature("x", "PocketV2", "default")


def test_rejects_a_variant_not_defined_for_the_type():
    with pytest.raises(ValueError, match="not valid for sheet-metal StraightBend"):
        sheet_metal_feature("x", "StraightBend", "rolled")


def test_every_emitted_type_is_in_the_catalog_with_real_operations():
    for feature_type in VARIANTS:
        assert feature_type in feature_types("sheet_metal")
        assert operations_for("sheet_metal", feature_type), f"{feature_type} has no catalog operations"


def test_catalog_pairs_each_variant_with_the_operation_it_implies():
    ops = operations_for("sheet_metal", "SimpleHole")
    assert "Extruding" in ops          # SimpleHole/extruded (hole-flanging)
    assert "3 Roll Bending" in operations_for("sheet_metal", "Form")   # Form/rolled
    assert "Embossing" in {o.split(":")[-1] for o in operations_for("sheet_metal", "Form")}  # Form/emboss
