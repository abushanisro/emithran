"""forging.feature_extractor.hole_features: the holes of a forging as feature_graph_v2 features, in the catalog's variants."""
import pytest

pytest.importorskip("OCC")

from forging.feature_extractor import hole_features  # noqa: E402


def _hole(feature_type, variant, steps=None):
    h = {"id": "hole-1", "feature_type": feature_type, "variant": variant, "face_ids": [3, 4], "diameter_mm": 3.2, "depth_mm": 24.0,
         "axis": [1.0, 0.0, 0.0], "angle_to_pull_deg": 0.0}
    if steps is not None:
        h["steps"] = steps
    return h


def test_a_stepped_bore_is_the_catalogs_stepped_multistephole():
    # Cannula Holder Right: a 3.2 mm through hole counterbored 4.5 mm x 2 mm. The recogniser calls it "through"; the catalog (and the
    # machining and die casting analyses) call a MultiStepHole "stepped", the variant machining after forging has an operation for.
    steps = [{"kind": "cylinder", "diameter_mm": 3.2, "length_mm": 22.0}, {"kind": "cylinder", "diameter_mm": 4.5, "length_mm": 2.0}]
    [f] = hole_features([_hole("MultiStepHole", "through", steps)], {})
    assert f["feature_type"] == "MultiStepHole"
    assert f["variant"] == "stepped"
    assert f["occurrences"][0]["steps"] == [{"diameter_mm": 3.2, "depth_mm": 22.0}, {"diameter_mm": 4.5, "depth_mm": 2.0}]


def test_a_plain_hole_keeps_through_or_blind():
    assert hole_features([_hole("SimpleHole", "through")], {})[0]["variant"] == "through"
    assert hole_features([_hole("SimpleHole", "blind")], {})[0]["variant"] == "blind"
