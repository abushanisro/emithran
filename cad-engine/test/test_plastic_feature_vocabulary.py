"""The plastic_molding feature vocabulary: the 12 feature types of memory/Plastic Modeling/process/digital_factory_operations.csv, and the gate that
every extracted feature_type must pass (shared/feature_vocabulary.py)."""
import pytest

from shared.feature_vocabulary import feature_types, operations_for, require_feature_type

TYPES = {
    "ComboVoid", "CurvedSurface", "CurvedWall", "LifterBundle", "MultiStepHole", "PartingLine",
    "PlanarFace", "Rib", "SharpEdge", "SimpleHole", "SlideBundle", "Void",
}


def test_the_domain_has_exactly_the_twelve_catalog_feature_types():
    assert feature_types("plastic_molding") == TYPES


def test_a_real_type_passes_the_gate_and_an_invented_one_fails_loudly():
    assert require_feature_type("plastic_molding", "SimpleHole") == "SimpleHole"
    with pytest.raises(ValueError):
        require_feature_type("plastic_molding", "SimpleHoles")


def test_the_coring_methods_a_hole_can_take_are_the_catalogs():
    assert operations_for("plastic_molding", "SimpleHole") == {"As Molded", "HoleNoCore", "HoleSideCore", "HoleLifter", "HoleUnscrewMandrel", "No Cost Feature"}
    assert operations_for("plastic_molding", "PartingLine") == {"Manual Flash Trimming", "No Cost Feature"}
    assert operations_for("plastic_molding", "SlideBundle") == {"Slides"}
    assert operations_for("plastic_molding", "LifterBundle") == {"Lifters"}
