"""
Tests for machining.machining_feature_recognizer's feature_graph_v2 synthesis
(build_machining_feature_graph_v2) and the classifier helpers it depends on.

Every feature_type asserted here is a reference catalog feature type
(shared/reference_features.json, generated from
memory/machining/operations_full__operations.csv) carrying its geometric
variant -- the exact strings operation-sequencer.ts dispatches on.

Pure Python (plain dicts, no OCC): these functions take plain dicts in/out.
Real-geometry coverage lives in test_cnc_turned_milled_real_brep.py.
"""
import pytest

from machining.feature_models import MachiningFeature
from machining.machining_feature_recognizer import (
    build_machining_feature_graph_v2,
    _classify_cone,
    _detect_counterbores,
    _classify_prismatic,
    _classify_prismatic_turned,
    _extract_diam_depth,
)


def _feat(ftype, variant, params, face_ids=None):
    return {"type": ftype, "variant": variant, "params": params, "face_ids": face_ids or [1]}


def _graph(*features, bbox_center=(0, 0, 0)):
    return build_machining_feature_graph_v2(
        {"features": list(features)}, bbox_center=bbox_center, face_map_list=[], total_tris=0,
    )


# ── Vocabulary gate ──────────────────────────────────────────────────────────

def test_machining_feature_rejects_a_type_outside_the_reference_catalog():
    with pytest.raises(ValueError, match="not a reference machining feature type"):
        MachiningFeature(id="x", type="through_hole", params={}, confidence=1.0)


def test_machining_feature_rejects_a_variant_not_defined_for_its_type():
    with pytest.raises(ValueError, match="not valid for SimpleHole"):
        MachiningFeature(id="x", type="SimpleHole", variant="counterbore", params={}, confidence=1.0)


def test_graph_builder_raises_on_an_unregistered_type_variant_instead_of_dropping_it():
    with pytest.raises(ValueError, match="no feature_graph_v2 shape registered"):
        _graph(_feat("SimpleHole", "made_up", {"centroid": (0, 0, 0), "diameter_mm": 5.0}))


# ── Ring / Edge / Slot toroid + outer-diameter shapes ────────────────────────

def test_outer_diameter_ring_survives_with_length_as_depth():
    params = {"centroid": (0, 0, 0), "diameter_mm": 25.0, "length_mm": 40.0, "position_along_axis_mm": 5.0}
    entry = _graph(_feat("Ring", "outer_diameter", params))["features"][0]
    assert (entry["feature_type"], entry["variant"]) == ("Ring", "outer_diameter")
    assert entry["diameter_mm"] == pytest.approx(25.0)
    assert entry["occurrences"][0]["depth_mm"] == pytest.approx(40.0)  # length_mm -> depth_mm


@pytest.mark.parametrize("ftype,variant", [("Edge", "round"), ("Ring", "groove"), ("Slot", "groove")])
def test_toroidal_features_bucket_by_major_diameter(ftype, variant):
    params = {"centroid": (5.0, 5.0, 0.0), "major_diameter_mm": 30.0, "radius_mm": 3.0}
    graph = _graph(_feat(ftype, variant, params))
    assert len(graph["features"]) == 1
    entry = graph["features"][0]
    assert (entry["feature_type"], entry["variant"]) == (ftype, variant)
    assert entry["diameter_mm"] == pytest.approx(30.0)
    assert entry["occurrences"][0]["radius_mm"] == pytest.approx(3.0)
    # No fabricated removed volume -- the arc sweep is not extracted.
    assert entry["occurrences"][0]["material_removed_mm3"] == 0.0


# ── SimpleHole / pcd_pattern ─────────────────────────────────────────────────

def test_pcd_pattern_survives_as_one_occurrence_with_real_hole_count():
    """Member bores are absorbed into the pattern, so the part bbox centre is
    the disclosed positional stand-in -- not a fabricated per-hole value."""
    params = {"pcd_mm": 60.0, "hole_count": 6, "hole_diameter_mm": 5.0, "depth_mm": 12.0}
    graph = _graph(_feat("SimpleHole", "pcd_pattern", params, face_ids=[1, 2, 3, 4, 5, 6]),
                   bbox_center=(1.0, 2.0, 3.0))
    entry = graph["features"][0]
    assert (entry["feature_type"], entry["variant"]) == ("SimpleHole", "pcd_pattern")
    assert entry["diameter_mm"] == pytest.approx(5.0)
    occ = entry["occurrences"][0]
    assert occ["hole_count"] == 6
    assert occ["pcd_mm"] == pytest.approx(60.0)
    assert occ["depth_mm"] == pytest.approx(12.0)
    assert occ["face_ids"] == [1, 2, 3, 4, 5, 6]
    assert occ["centroid"] == [0.0, 0.0, 0.0]  # bbox_center applied, then re-centred


def test_pcd_pattern_without_a_diameter_buckets_at_zero():
    graph = _graph(_feat("SimpleHole", "pcd_pattern", {"pcd_mm": 60.0, "hole_count": 4}))
    assert graph["features"][0]["diameter_mm"] == 0.0


# ── _classify_cone ───────────────────────────────────────────────────────────

def test_classify_cone_chamfer_carries_centroid():
    cone = {"centroid": (10.0, 20.0, 5.0), "half_angle_deg": 45.0, "ref_radius": 3.0}
    variant, params, _ = _classify_cone(cone, cylinders=[])
    assert variant == "chamfer"
    assert params["centroid"] == (10.0, 20.0, 5.0)
    assert params["diameter_mm"] == pytest.approx(6.0)


def test_classify_cone_countersink_carries_centroid_and_bore_data():
    cone = {"centroid": (10.0, 20.0, 5.0), "half_angle_deg": 45.0, "ref_radius": 3.0}
    coaxial_bore = {"kind": "blind_hole", "centroid": (10.0, 20.0, 4.9), "radius": 1.5}
    variant, params, _ = _classify_cone(cone, cylinders=[coaxial_bore])
    assert variant == "countersink"
    assert params["centroid"] == (10.0, 20.0, 5.0)
    assert params["entry_diameter_mm"] == pytest.approx(6.0)
    assert params["bore_diameter_mm"] == pytest.approx(3.0)


# ── _detect_counterbores ─────────────────────────────────────────────────────

class _F:
    def __init__(self, id_, diameter_mm, depth_mm):
        self.id = id_
        self.params = {"diameter_mm": diameter_mm, "depth_mm": depth_mm}


def test_detect_counterbores_carries_centroid_from_outer_bore():
    bore_id_to_cyl = {"o1": {"centroid": (1.0, 2.0, 3.0)}, "i1": {"centroid": (1.05, 2.02, 3.0)}}
    (_, _, params), = _detect_counterbores([_F("o1", 10.0, 3.0), _F("i1", 5.0, 15.0)], bore_id_to_cyl)
    assert params["centroid"] == (1.0, 2.0, 3.0)
    assert params["counterbore_diameter_mm"] == 10.0
    assert params["counterbore_depth_mm"] == 3.0
    assert params["bore_diameter_mm"] == 5.0


def test_detect_counterbores_omits_centroid_without_position_data_rather_than_fabricating():
    (_, _, params), = _detect_counterbores([_F("o1", 10.0, 3.0), _F("i1", 5.0, 15.0)], bore_id_to_cyl=None)
    assert "centroid" not in params


# ── _classify_prismatic / _classify_prismatic_turned ─────────────────────────

def test_classify_prismatic_pocket():
    pocket = {"dims": [5.0, 20.0, 22.0], "normal": (0, 0, 1), "centroid": (3.0, 4.0, 5.0)}
    ftype, variant, params = _classify_prismatic(pocket, main_axis=(0, 0, 1))
    assert (ftype, variant) == ("PocketV2", "default")
    assert params["centroid"] == (3.0, 4.0, 5.0)


def test_classify_prismatic_straight_slot():
    # aspect 30/5 = 6 > 2.5, floor normal perpendicular to the datum axis
    pocket = {"dims": [2.0, 5.0, 30.0], "normal": (1, 0, 0), "centroid": (7.0, 8.0, 9.0)}
    ftype, variant, params = _classify_prismatic(pocket, main_axis=(0, 0, 1))
    assert (ftype, variant) == ("Slot", "straight")
    assert params["centroid"] == (7.0, 8.0, 9.0)


def test_classify_prismatic_keyway_carries_length_mm():
    pocket = {"dims": [2.0, 6.0, 40.0], "normal": (0, 0, 1), "centroid": (3.0, 4.0, 5.0)}
    ftype, variant, params = _classify_prismatic(pocket, main_axis=(0, 0, 1))
    assert (ftype, variant) == ("Keyway", "default")
    assert params["length_mm"] == pytest.approx(40.0)
    assert params["width_mm"] == pytest.approx(6.0)
    assert params["depth_mm"] == pytest.approx(2.0)


def test_classify_prismatic_turned_keyway_carries_length_mm():
    pocket = {"dims": [2.0, 6.0, 40.0], "normal": (0, 0, 1), "centroid": (1.0, 1.0, 1.0)}
    ftype, variant, params = _classify_prismatic_turned(pocket, main_axis=(0, 0, 1))
    assert (ftype, variant) == ("Keyway", "default")
    assert params["length_mm"] == pytest.approx(40.0)


def test_classify_prismatic_turned_radial_slot():
    pocket = {"dims": [2.0, 5.0, 30.0], "normal": (1, 0, 0), "centroid": (1.0, 1.0, 1.0)}
    ftype, variant, params = _classify_prismatic_turned(pocket, main_axis=(0, 0, 1))
    assert (ftype, variant) == ("Slot", "radial")
    assert params["centroid"] == (1.0, 1.0, 1.0)


# ── _extract_diam_depth ──────────────────────────────────────────────────────

@pytest.mark.parametrize("variant", ["through", "blind", "threaded", "cross"])
def test_extract_diam_depth_simple_hole(variant):
    assert _extract_diam_depth("SimpleHole", variant, {"diameter_mm": 6.0, "depth_mm": 12.0}) == (6.0, 12.0)


def test_extract_diam_depth_counterbore_uses_its_own_field_names():
    diam, depth = _extract_diam_depth("MultiStepHole", "counterbore", {
        "counterbore_diameter_mm": 10.0, "counterbore_depth_mm": 3.0,
        "bore_diameter_mm": 5.0, "bore_depth_mm": 15.0,
    })
    assert (diam, depth) == (10.0, 3.0)


def test_extract_diam_depth_countersink_derives_depth_from_cone_geometry():
    diam, depth = _extract_diam_depth("Edge", "countersink", {
        "entry_diameter_mm": 8.0, "bore_diameter_mm": 4.0, "half_angle_deg": 45.0,
    })
    assert diam == 8.0
    assert depth == pytest.approx(2.0)  # (8-4)/2 / tan(45°)


def test_extract_diam_depth_countersink_without_geometry_returns_zero_not_fabricated():
    assert _extract_diam_depth("Edge", "countersink", {"entry_diameter_mm": 8.0}) == (8.0, 0.0)


def test_extract_diam_depth_chamfer_has_no_depth_concept():
    assert _extract_diam_depth("Edge", "chamfer", {"diameter_mm": 5.0}) == (5.0, 0.0)


# ── build_machining_feature_graph_v2: end-to-end preservation ────────────────

@pytest.mark.parametrize("ftype,variant,params", [
    ("SimpleHole", "through", {"centroid": (0, 0, 0), "diameter_mm": 6.0, "depth_mm": 10.0}),
    ("SimpleHole", "blind", {"centroid": (10, 0, 0), "diameter_mm": 8.0, "depth_mm": 5.0}),
    ("SimpleHole", "threaded", {"centroid": (20, 0, 0), "diameter_mm": 4.2, "depth_mm": 8.0, "spec": "M5x0.8"}),
    ("SimpleHole", "cross", {"centroid": (25, 0, 0), "diameter_mm": 4.0, "depth_mm": 9.0}),
    ("MultiStepHole", "counterbore", {"centroid": (30, 0, 0), "counterbore_diameter_mm": 10.0, "counterbore_depth_mm": 3.0, "bore_diameter_mm": 5.0}),
    ("Edge", "countersink", {"centroid": (40, 0, 0), "entry_diameter_mm": 8.0, "bore_diameter_mm": 4.0, "half_angle_deg": 45.0}),
    ("Edge", "chamfer", {"centroid": (50, 0, 0), "diameter_mm": 5.0, "half_angle_deg": 45.0}),
])
def test_each_diameter_feature_survives_with_its_type_and_variant(ftype, variant, params):
    graph = _graph(_feat(ftype, variant, params))
    assert len(graph["features"]) == 1, f"{ftype}/{variant} was silently dropped"
    entry = graph["features"][0]
    assert (entry["feature_type"], entry["variant"]) == (ftype, variant)
    assert entry["occurrences"][0]["tapped"] is (variant == "threaded")


@pytest.mark.parametrize("ftype,variant", [
    ("PocketV2", "default"), ("Slot", "straight"), ("Slot", "radial"),
])
def test_volumetric_features_keep_their_type_and_variant(ftype, variant):
    params = {"centroid": (0, 0, 0), "depth_mm": 5.0, "width_mm": 8.0, "length_mm": 30.0}
    entry = _graph(_feat(ftype, variant, params))["features"][0]
    assert (entry["feature_type"], entry["variant"]) == (ftype, variant)
    assert entry["occurrences"][0]["material_removed_mm3"] == pytest.approx(5.0 * 8.0 * 30.0)


def test_keyway_survives_with_real_length_width_depth():
    params = {"centroid": (0, 0, 0), "depth_mm": 4.0, "width_mm": 6.0, "length_mm": 40.0}
    entry = _graph(_feat("Keyway", "default", params))["features"][0]
    assert entry["feature_type"] == "Keyway"
    occ = entry["occurrences"][0]
    assert (occ["length_mm"], occ["width_mm"], occ["depth_mm"]) == (40.0, 6.0, 4.0)


def test_full_realistic_part_preserves_every_distinct_feature_and_drops_nothing():
    features = [
        _feat("SimpleHole", "through", {"centroid": (0, 0, 0), "diameter_mm": 6.0, "depth_mm": 10.0}),
        _feat("SimpleHole", "through", {"centroid": (20, 0, 0), "diameter_mm": 6.0, "depth_mm": 10.0}),
        _feat("SimpleHole", "threaded", {"centroid": (40, 0, 0), "diameter_mm": 4.2, "depth_mm": 8.0, "spec": "M5x0.8"}),
        _feat("MultiStepHole", "counterbore", {"centroid": (60, 0, 0), "counterbore_diameter_mm": 10.0, "counterbore_depth_mm": 3.0, "bore_diameter_mm": 5.0}),
        _feat("Edge", "countersink", {"centroid": (80, 0, 0), "entry_diameter_mm": 8.0, "bore_diameter_mm": 4.0, "half_angle_deg": 45.0}),
        _feat("Edge", "chamfer", {"centroid": (100, 0, 0), "diameter_mm": 5.0, "half_angle_deg": 45.0}),
        _feat("PocketV2", "default", {"centroid": (0, 20, 0), "depth_mm": 5.0, "width_mm": 20.0, "length_mm": 22.0}),
        _feat("Slot", "straight", {"centroid": (0, 40, 0), "depth_mm": 3.0, "width_mm": 6.0, "length_mm": 25.0}),
        _feat("Keyway", "default", {"centroid": (0, 60, 0), "depth_mm": 4.0, "width_mm": 6.0, "length_mm": 40.0}),
    ]
    by_key = {(f["feature_type"], f["variant"]): f for f in _graph(*features)["features"]}
    assert set(by_key) == {
        ("SimpleHole", "through"), ("SimpleHole", "threaded"), ("MultiStepHole", "counterbore"),
        ("Edge", "countersink"), ("Edge", "chamfer"), ("PocketV2", "default"),
        ("Slot", "straight"), ("Keyway", "default"),
    }
    # Two identical-diameter through holes group into one entry with two occurrences.
    assert len(by_key[("SimpleHole", "through")]["occurrences"]) == 2
