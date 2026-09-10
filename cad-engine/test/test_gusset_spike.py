"""
Tests for sheet_metal.features.gusset_spike -- the gusset-corner
FEASIBILITY SPIKE. See that module's docstring for full context: this is
NOT a production detector and is NOT wired into
SheetMetalFeatureExtractor.extract().

All tests here exercise _classify_candidates directly, on synthetic dicts in
the same shape a real caller would assemble from raw_cylinders_full's tuples
and bend_relationships.py's real face-adjacency/area data.

NO real-OCC integration test exists in this file -- constructing a genuine
formed-box-corner B-Rep solid (with and without a real fused gusset tab) is
itself nontrivial OCC boolean/fillet work, independent of whether the
classification logic below is sound, and was not attempted in this pass --
see gusset_spike.py's own "FIXTURE LIMITATION" docstring section. Real-B-Rep
verification of this spike remains open, same as its lancing/forming
siblings.
"""
import pytest

from sheet_metal.features.gusset_spike import (
    _classify_candidates,
    _min_endpoint_distance,
    MAX_CORNER_AXIS_DOT,
    MAX_CORNER_ENDPOINT_DISTANCE_TO_THICKNESS_RATIO,
    MAX_BRIDGE_FACE_AREA_TO_THICKNESS_SQUARED_RATIO,
)

THICKNESS = 2.0  # mm


def _bend(axis_dir, cx, cy, cz, axial_length=20.0, face_idx=1) -> dict:
    return {
        "axis_dir": axis_dir,
        "centroid_mm": (cx, cy, cz),
        "axial_length_mm": axial_length,
        "face_ids": [face_idx],
    }


# Two bend lines meeting at a real box corner: one running along X near
# x=0..20 at y=0 (axis (1,0,0)), the other along Y near y=0..20 at x=0
# (axis (0,1,0)) -- their nearest ends both sit near the origin corner.
BEND_A = _bend((1.0, 0.0, 0.0), cx=10.0, cy=0.0, cz=0.0, face_idx=1)
BEND_B = _bend((0.0, 1.0, 0.0), cx=0.0, cy=10.0, cz=0.0, face_idx=2)


class TestPositiveDetectionOpenCorner:
    def test_perpendicular_close_bends_with_no_bridging_face_is_a_confident_negative(self):
        """The decisive, non-ambiguous case this spike can actually resolve:
        two real bends meet at a corner (perpendicular axes, close ends) but
        no real face bridges them -- an honest, confident 'no gusset here'."""
        candidates = _classify_candidates([BEND_A, BEND_B], THICKNESS, {(0, 1): None})
        assert len(candidates) == 1
        c = candidates[0]
        assert c["is_closed"] is False
        assert c["recognition_status"] == "recognized"
        assert c["bridging_face_area_mm2"] is None


class TestPositiveDetectionClosedCorner:
    def test_perpendicular_close_bends_with_a_small_bridging_face_is_an_ambiguous_candidate(self):
        """A real small face bridges the two bends' walls -- a plausible
        gusset, but never reported as confidently 'recognized' (see module
        docstring's honest limitation)."""
        small_area = 4.0  # well under 12 * 2^2 = 48
        candidates = _classify_candidates([BEND_A, BEND_B], THICKNESS, {(0, 1): small_area})
        assert len(candidates) == 1
        c = candidates[0]
        assert c["is_closed"] is True
        assert c["recognition_status"] == "ambiguous"
        assert c["bridging_face_area_mm2"] == pytest.approx(small_area)


class TestNegativeDetection:
    def test_parallel_bends_are_not_a_corner_pair(self):
        """Two bends with parallel (not perpendicular) axes are the in-line
        case bend_relationships.py already covers -- not a corner."""
        parallel_b = _bend((1.0, 0.0, 0.0), cx=10.0, cy=5.0, cz=0.0, face_idx=2)
        assert _classify_candidates([BEND_A, parallel_b], THICKNESS, {(0, 1): None}) == []

    def test_perpendicular_but_distant_bends_are_not_the_same_corner(self):
        far_b = _bend((0.0, 1.0, 0.0), cx=0.0, cy=1000.0, cz=0.0, face_idx=2)
        assert _classify_candidates([BEND_A, far_b], THICKNESS, {(0, 1): None}) == []

    def test_bridging_face_far_too_large_is_excluded_as_an_unrelated_panel(self):
        large_area = 1000.0  # far exceeds 12 * 2^2 = 48
        assert _classify_candidates([BEND_A, BEND_B], THICKNESS, {(0, 1): large_area}) == []

    def test_zero_sheet_thickness_returns_no_candidates(self):
        assert _classify_candidates([BEND_A, BEND_B], 0.0, {(0, 1): None}) == []

    def test_bend_missing_axis_dir_is_skipped_honestly(self):
        broken = {"centroid_mm": (0.0, 0.0, 0.0), "axial_length_mm": 20.0, "face_ids": [3]}
        assert _classify_candidates([BEND_A, broken], THICKNESS, {(0, 1): None}) == []


class TestBoundary:
    def test_axis_dot_exactly_at_ceiling_is_admitted(self):
        assert MAX_CORNER_AXIS_DOT == 0.35
        # cos(theta) = 0.35 tilt on an otherwise-perpendicular pair
        tilted = _bend((0.35, (1 - 0.35 ** 2) ** 0.5, 0.0), cx=0.0, cy=10.0, cz=0.0, face_idx=2)
        candidates = _classify_candidates([BEND_A, tilted], THICKNESS, {(0, 1): None})
        assert len(candidates) == 1

    def test_axis_dot_just_over_ceiling_is_excluded(self):
        tilted = _bend((0.36, (1 - 0.36 ** 2) ** 0.5, 0.0), cx=0.0, cy=10.0, cz=0.0, face_idx=2)
        assert _classify_candidates([BEND_A, tilted], THICKNESS, {(0, 1): None}) == []


class TestEndpointDistanceHelper:
    def test_min_endpoint_distance_finds_the_real_nearest_pair(self):
        # BEND_A spans x=0..20 at y=0; BEND_B spans y=0..20 at x=0 -- both
        # have an endpoint at/near the origin.
        d = _min_endpoint_distance(BEND_A, BEND_B)
        assert d == pytest.approx(0.0, abs=1e-6)


class TestHonestLimitation:
    def test_closed_corner_candidate_never_reports_recognized(self):
        """THE central honest finding for the closed-corner case: a real
        small bridging face at a near-perpendicular bend corner cannot be
        told apart from an unrelated design chamfer/fillet/bracket face that
        happens to sit at the same location -- see module docstring. Only
        the OPEN-corner (no face) case is ever a confident 'recognized'."""
        candidates = _classify_candidates([BEND_A, BEND_B], THICKNESS, {(0, 1): 4.0})
        assert candidates[0]["recognition_status"] == "ambiguous"
        assert all(c["recognition_status"] != "recognized" for c in candidates if c["is_closed"])
