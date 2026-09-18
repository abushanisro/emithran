"""
Tests for machining.cnc_feature_recognizer's feature_graph_v2 synthesis --
build_feature_graph_v2_from_cnc, plus the classifier fixes it depends on
(_classify_cone, _detect_counterbores, _classify_prismatic,
_classify_prismatic_turned).

Root-caused 2026-09-16: real detectors exist for every CNC feature type the
costing pipeline (operation-sequencer.ts / cost-cnc-engine.ts) needs, but
build_feature_graph_v2_from_cnc collapsed through_hole/blind_hole/
tapped_hole/cross_hole/counterbore into one generic "hole" string
(operation-sequencer.ts's switch has no "hole" case -- it matches the exact
type strings), and counterbore/countersink/chamfer/pocket/slot/keyway/
radial_slot never carried a "centroid" key in their classifier-returned
params at all (only the raw hole cylinders did), so build_feature_graph_v2_
from_cnc's required-centroid check silently dropped every one of them --
worse than a mislabel, a total loss. Every test below is pure Python
(synthetic dicts, no OCC) -- these functions take plain dicts in/out, no
pythonocc-core dependency, matching test_forming_spike.py's established
style for this codebase's non-geometric assertions.
"""
import math

import pytest

from machining.cnc_feature_recognizer import (
    build_feature_graph_v2_from_cnc,
    _classify_cone,
    _detect_counterbores,
    _classify_prismatic,
    _classify_prismatic_turned,
    _extract_diam_depth,
)


# ── _classify_cone: centroid must be present, chamfer vs countersink ────────

def test_classify_cone_chamfer_carries_centroid():
    cone = {"centroid": (10.0, 20.0, 5.0), "half_angle_deg": 45.0, "ref_radius": 3.0}
    ftype, params, conf = _classify_cone(cone, cylinders=[])
    assert ftype == "chamfer"
    assert params["centroid"] == (10.0, 20.0, 5.0)
    assert params["diameter_mm"] == pytest.approx(6.0)


def test_classify_cone_countersink_carries_centroid_and_bore_data():
    cone = {"centroid": (10.0, 20.0, 5.0), "half_angle_deg": 45.0, "ref_radius": 3.0}
    coaxial_bore = {"kind": "blind_hole", "centroid": (10.0, 20.0, 4.9), "radius": 1.5}
    ftype, params, conf = _classify_cone(cone, cylinders=[coaxial_bore])
    assert ftype == "countersink"
    assert params["centroid"] == (10.0, 20.0, 5.0)
    assert params["entry_diameter_mm"] == pytest.approx(6.0)
    assert params["bore_diameter_mm"] == pytest.approx(3.0)


# ── _detect_counterbores: centroid must be present (outer bore's position) ──

class _F:
    def __init__(self, id_, diameter_mm, depth_mm):
        self.id = id_
        self.params = {"diameter_mm": diameter_mm, "depth_mm": depth_mm}


def test_detect_counterbores_carries_centroid_from_outer_bore():
    outer = _F("o1", 10.0, 3.0)
    inner = _F("i1", 5.0, 15.0)
    bore_id_to_cyl = {
        "o1": {"centroid": (1.0, 2.0, 3.0)},
        "i1": {"centroid": (1.05, 2.02, 3.0)},
    }
    results = _detect_counterbores([outer, inner], bore_id_to_cyl)
    assert len(results) == 1
    outer_id, inner_id, params = results[0]
    assert params["centroid"] == (1.0, 2.0, 3.0)
    assert params["counterbore_diameter_mm"] == 10.0
    assert params["counterbore_depth_mm"] == 3.0
    assert params["bore_diameter_mm"] == 5.0


def test_detect_counterbores_omits_centroid_without_position_data_rather_than_fabricating():
    outer = _F("o1", 10.0, 3.0)
    inner = _F("i1", 5.0, 15.0)
    results = _detect_counterbores([outer, inner], bore_id_to_cyl=None)
    assert len(results) == 1
    _, _, params = results[0]
    assert "centroid" not in params


# ── _classify_prismatic / _classify_prismatic_turned: centroid present ──────

def test_classify_prismatic_pocket_carries_centroid():
    pocket = {"dims": [5.0, 20.0, 22.0], "normal": (0, 0, 1), "centroid": (3.0, 4.0, 5.0)}
    ftype, params = _classify_prismatic(pocket, main_axis=(0, 0, 1))
    assert ftype == "pocket"
    assert params["centroid"] == (3.0, 4.0, 5.0)


def test_classify_prismatic_slot_carries_centroid():
    # aspect = long/mid = 30/5 = 6 > 2.5, floor normal perpendicular to main axis
    pocket = {"dims": [2.0, 5.0, 30.0], "normal": (1, 0, 0), "centroid": (7.0, 8.0, 9.0)}
    ftype, params = _classify_prismatic(pocket, main_axis=(0, 0, 1))
    assert ftype == "slot"
    assert params["centroid"] == (7.0, 8.0, 9.0)


def test_classify_prismatic_keyway_carries_length_mm():
    """Root-caused 2026-09-17: the keyway case computed "long" (the keyway's
    real length along the shaft) but never returned it as "length_mm" --
    every sibling type (slot/radial_slot/pocket) already did. dot_with_axis
    > 0.85 (floor normal parallel to main_axis) selects the keyway branch."""
    pocket = {"dims": [2.0, 6.0, 40.0], "normal": (0, 0, 1), "centroid": (3.0, 4.0, 5.0)}
    ftype, params = _classify_prismatic(pocket, main_axis=(0, 0, 1))
    assert ftype == "keyway"
    assert params["length_mm"] == pytest.approx(40.0)
    assert params["width_mm"] == pytest.approx(6.0)
    assert params["depth_mm"] == pytest.approx(2.0)
    assert params["centroid"] == (3.0, 4.0, 5.0)


def test_classify_prismatic_turned_keyway_carries_length_mm():
    pocket = {"dims": [2.0, 6.0, 40.0], "normal": (0, 0, 1), "centroid": (1.0, 1.0, 1.0)}
    result = _classify_prismatic_turned(pocket, main_axis=(0, 0, 1))
    assert result is not None
    ftype, params = result
    assert ftype == "keyway"
    assert params["length_mm"] == pytest.approx(40.0)
    assert params["width_mm"] == pytest.approx(6.0)
    assert params["depth_mm"] == pytest.approx(2.0)
    assert params["centroid"] == (1.0, 1.0, 1.0)


def test_classify_prismatic_turned_radial_slot_carries_centroid():
    pocket = {"dims": [2.0, 5.0, 30.0], "normal": (1, 0, 0), "centroid": (1.0, 1.0, 1.0)}
    result = _classify_prismatic_turned(pocket, main_axis=(0, 0, 1))
    assert result is not None
    ftype, params = result
    assert ftype == "radial_slot"
    assert params["centroid"] == (1.0, 1.0, 1.0)


# ── _extract_diam_depth: per-type real field mapping ─────────────────────────

def test_extract_diam_depth_simple_hole_types():
    for ftype in ("through_hole", "blind_hole", "tapped_hole", "cross_hole"):
        diam, depth = _extract_diam_depth(ftype, {"diameter_mm": 6.0, "depth_mm": 12.0})
        assert diam == 6.0 and depth == 12.0


def test_extract_diam_depth_counterbore_uses_its_own_field_names():
    diam, depth = _extract_diam_depth("counterbore", {
        "counterbore_diameter_mm": 10.0, "counterbore_depth_mm": 3.0,
        "bore_diameter_mm": 5.0, "bore_depth_mm": 15.0,
    })
    assert diam == 10.0 and depth == 3.0


def test_extract_diam_depth_countersink_derives_depth_from_cone_geometry():
    diam, depth = _extract_diam_depth("countersink", {
        "entry_diameter_mm": 8.0, "bore_diameter_mm": 4.0, "half_angle_deg": 45.0,
    })
    assert diam == 8.0
    # step_r = (8-4)/2 = 2; tan(45deg) = 1 -> depth = 2/1 = 2.0
    assert depth == pytest.approx(2.0)


def test_extract_diam_depth_countersink_without_geometry_returns_zero_not_fabricated():
    diam, depth = _extract_diam_depth("countersink", {"entry_diameter_mm": 8.0})
    assert diam == 8.0
    assert depth == 0.0


def test_extract_diam_depth_chamfer_has_no_depth_concept():
    diam, depth = _extract_diam_depth("chamfer", {"diameter_mm": 5.0})
    assert diam == 5.0 and depth == 0.0


# ── build_feature_graph_v2_from_cnc: end-to-end type preservation ───────────

def _cnc_feat(ftype, params, face_ids=None):
    return {"type": ftype, "params": params, "face_ids": face_ids or [1]}


@pytest.mark.parametrize("ftype,params", [
    ("through_hole", {"centroid": (0, 0, 0), "diameter_mm": 6.0, "depth_mm": 10.0}),
    ("blind_hole", {"centroid": (10, 0, 0), "diameter_mm": 8.0, "depth_mm": 5.0}),
    ("tapped_hole", {"centroid": (20, 0, 0), "diameter_mm": 4.2, "depth_mm": 8.0, "spec": "M5x0.8"}),
    ("counterbore", {"centroid": (30, 0, 0), "counterbore_diameter_mm": 10.0, "counterbore_depth_mm": 3.0, "bore_diameter_mm": 5.0}),
    ("countersink", {"centroid": (40, 0, 0), "entry_diameter_mm": 8.0, "bore_diameter_mm": 4.0, "half_angle_deg": 45.0}),
    ("chamfer", {"centroid": (50, 0, 0), "diameter_mm": 5.0, "half_angle_deg": 45.0}),
])
def test_each_diameter_type_survives_with_its_real_type_string(ftype, params):
    """Before the fix: through_hole/blind_hole/tapped_hole/counterbore all
    became "hole"; countersink/chamfer were dropped entirely (no centroid).
    operation-sequencer.ts's switch only matches the real type strings."""
    cnc_dict = {"features": [_cnc_feat(ftype, params)]}
    graph = build_feature_graph_v2_from_cnc(cnc_dict, bbox_center=(0, 0, 0), face_map_list=[], total_tris=0)
    assert len(graph["features"]) == 1, f"{ftype} feature was silently dropped"
    assert graph["features"][0]["feature_type"] == ftype, (
        f"{ftype} was relabeled as {graph['features'][0]['feature_type']!r} instead of preserving its real type"
    )


@pytest.mark.parametrize("raw_ftype,expected_out", [
    ("pocket", "pocket"),
    ("slot", "slot"),
    ("radial_slot", "slot"),
])
def test_pocket_and_slot_variants_map_to_what_operation_sequencer_actually_switches_on(raw_ftype, expected_out):
    """operation-sequencer.ts's switch only has cases for "pocket" and
    "slot" -- radial_slot must fold into "slot" (no dedicated case for it
    yet), not pass through as its own unmatched string (which would
    silently fall to the volume-only default case). "keyway" is NOT in
    this list any more -- see test_keyway_survives_as_its_own_type_with_
    real_length_mm below: it now has a real dedicated consumer (Keyway
    Broaching), so it is no longer folded into "slot"."""
    params = {"centroid": (0, 0, 0), "depth_mm": 5.0, "width_mm": 8.0, "length_mm": 30.0}
    cnc_dict = {"features": [_cnc_feat(raw_ftype, params)]}
    graph = build_feature_graph_v2_from_cnc(cnc_dict, bbox_center=(0, 0, 0), face_map_list=[], total_tris=0)
    assert len(graph["features"]) == 1, f"{raw_ftype} feature was silently dropped"
    assert graph["features"][0]["feature_type"] == expected_out


def test_keyway_survives_as_its_own_type_with_real_length_mm():
    """Root-caused 2026-09-17: keyway was being deliberately collapsed into
    generic "slot" output, discarding the one signal (feature_type ==
    "keyway") a dedicated Keyway Broaching cost engine needs to find these
    occurrences and cost them with real linear-stroke broach physics
    instead of silently being priced as an ordinary milled slot. It must
    now survive as "keyway", carrying its own real width_mm/depth_mm AND
    length_mm (the keyway's real length along the shaft -- previously
    omitted even in the classifier output, see
    test_classify_prismatic_keyway_carries_length_mm below)."""
    params = {"centroid": (0, 0, 0), "depth_mm": 4.0, "width_mm": 6.0, "length_mm": 40.0}
    cnc_dict = {"features": [_cnc_feat("keyway", params)]}
    graph = build_feature_graph_v2_from_cnc(cnc_dict, bbox_center=(0, 0, 0), face_map_list=[], total_tris=0)
    assert len(graph["features"]) == 1, "keyway feature was silently dropped"
    feat = graph["features"][0]
    assert feat["feature_type"] == "keyway"
    occ = feat["occurrences"][0]
    assert occ["length_mm"] == pytest.approx(40.0)
    assert occ["width_mm"] == pytest.approx(6.0)
    assert occ["depth_mm"] == pytest.approx(4.0)


def test_full_realistic_part_preserves_every_distinct_type_and_drops_nothing():
    """A representative machined part: 2 through-holes (same diameter, grouped),
    1 tapped hole, 1 counterbore, 1 countersink, 1 chamfer, 1 pocket, 1 slot,
    1 keyway. Every one of the 8 distinct feature_type entries must survive."""
    features = [
        _cnc_feat("through_hole", {"centroid": (0, 0, 0), "diameter_mm": 6.0, "depth_mm": 10.0}),
        _cnc_feat("through_hole", {"centroid": (20, 0, 0), "diameter_mm": 6.0, "depth_mm": 10.0}),
        _cnc_feat("tapped_hole", {"centroid": (40, 0, 0), "diameter_mm": 4.2, "depth_mm": 8.0, "spec": "M5x0.8"}),
        _cnc_feat("counterbore", {"centroid": (60, 0, 0), "counterbore_diameter_mm": 10.0, "counterbore_depth_mm": 3.0, "bore_diameter_mm": 5.0}),
        _cnc_feat("countersink", {"centroid": (80, 0, 0), "entry_diameter_mm": 8.0, "bore_diameter_mm": 4.0, "half_angle_deg": 45.0}),
        _cnc_feat("chamfer", {"centroid": (100, 0, 0), "diameter_mm": 5.0, "half_angle_deg": 45.0}),
        _cnc_feat("pocket", {"centroid": (0, 20, 0), "depth_mm": 5.0, "width_mm": 20.0, "length_mm": 22.0}),
        _cnc_feat("slot", {"centroid": (0, 40, 0), "depth_mm": 3.0, "width_mm": 6.0, "length_mm": 25.0}),
        _cnc_feat("keyway", {"centroid": (0, 60, 0), "depth_mm": 4.0, "width_mm": 6.0, "length_mm": 40.0}),
    ]
    cnc_dict = {"features": features}
    graph = build_feature_graph_v2_from_cnc(cnc_dict, bbox_center=(0, 0, 0), face_map_list=[], total_tris=0)

    by_type = {f["feature_type"]: f for f in graph["features"]}
    assert set(by_type.keys()) == {
        "through_hole", "tapped_hole", "counterbore", "countersink", "chamfer", "pocket", "slot", "keyway",
    }
    # The two identical-diameter through_holes group into one entry, two occurrences.
    assert len(by_type["through_hole"]["occurrences"]) == 2
    for other in ("tapped_hole", "counterbore", "countersink", "chamfer", "pocket", "slot", "keyway"):
        assert len(by_type[other]["occurrences"]) == 1
