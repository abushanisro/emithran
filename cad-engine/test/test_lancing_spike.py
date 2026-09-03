"""
Tests for sheet_metal.features.lancing_spike -- the lance-candidate
FEASIBILITY SPIKE. See that module's docstring for full context: this is
NOT a production detector and is NOT wired into
SheetMetalFeatureExtractor.extract().

All tests here exercise _classify_candidates directly, on synthetic dicts
in the same shape a real caller would assemble from _is_bend_cylinder's
tuples and bend_relationships.py's real face-adjacency/area data.

NO real-OCC integration test exists in this file -- constructing a genuine
fused/tilted 3-sided-cut lance solid (base plate + a separately-built,
rotated flap fused at one true coincident hinge edge, with a real fillet
radius at that hinge so _is_bend_cylinder actually has a cylindrical face
to find) is itself nontrivial OCC boolean/fillet work, independent of
whether the classification logic below is sound, and was not attempted in
this pass -- see lancing_spike.py's own "FIXTURE LIMITATION" docstring
section. Real-B-Rep verification of this spike remains open.
"""
import pytest

from sheet_metal.features.lancing_spike import (
    _classify_candidates,
    MAX_HINGE_LENGTH_TO_PANEL_WIDTH_RATIO,
    MAX_FLANGE_AREA_TO_HINGE_LENGTH_SQUARED_RATIO,
)

PANEL_MIN_DIM = 100.0  # mm


def _bend(hinge_len: float, flange_area, cx=50.0, cy=50.0, cz=0.0, face_idx=1) -> dict:
    return {
        "axial_length_mm": hinge_len,
        "flange_area_mm2": flange_area,
        "centroid_mm": [cx, cy, cz],
        "face_ids": [face_idx],
    }


class TestPositiveDetection:
    def test_short_hinge_with_small_flange_is_a_candidate(self):
        """A 10mm-wide flap hinge (well under the panel-width ratio ceiling)
        with a roughly flap-sized far-side face (e.g. 10x8mm = 80mm^2,
        comfortably under 8x hinge_len^2=800mm^2) is a plausible lance
        candidate -- this is the entire feasibility question this spike
        answers yes to."""
        assert MAX_HINGE_LENGTH_TO_PANEL_WIDTH_RATIO == 0.35
        assert MAX_FLANGE_AREA_TO_HINGE_LENGTH_SQUARED_RATIO == 8.0
        b = _bend(hinge_len=10.0, flange_area=80.0)
        candidates = _classify_candidates([b], PANEL_MIN_DIM)
        assert len(candidates) == 1
        c = candidates[0]
        assert c["hinge_length_mm"] == pytest.approx(10.0)
        assert c["flange_area_mm2"] == pytest.approx(80.0)
        assert c["recognition_status"] == "ambiguous"  # never 'recognized' -- see module docstring


class TestNegativeDetection:
    def test_hinge_spanning_most_of_the_panel_is_excluded(self):
        """A bend whose length is close to the panel's own width is a real
        full bend (e.g. a standard press-brake flange), not a small flap
        hinge."""
        b = _bend(hinge_len=60.0, flange_area=3600.0)  # 60mm on a 100mm-wide panel = 0.6 ratio
        assert _classify_candidates([b], PANEL_MIN_DIM) == []

    def test_large_flange_relative_to_hinge_is_excluded(self):
        """A short hinge whose far-side face is much larger than a flap of
        that hinge width would be -- a real continuing panel, not a small
        tab."""
        b = _bend(hinge_len=10.0, flange_area=5000.0)  # far exceeds 8*10^2=800
        assert _classify_candidates([b], PANEL_MIN_DIM) == []

    def test_missing_flange_area_is_excluded(self):
        """A bend with no resolvable far-side neighbor (degenerate
        topology) must be honestly skipped, never guessed."""
        b = _bend(hinge_len=10.0, flange_area=None)
        assert _classify_candidates([b], PANEL_MIN_DIM) == []

    def test_zero_panel_dimension_returns_no_candidates(self):
        b = _bend(hinge_len=10.0, flange_area=80.0)
        assert _classify_candidates([b], 0.0) == []

    def test_zero_length_hinge_is_excluded(self):
        b = _bend(hinge_len=0.0, flange_area=80.0)
        assert _classify_candidates([b], PANEL_MIN_DIM) == []


class TestMultipleInstances:
    def test_several_independent_candidates_all_reported(self):
        bends = [
            _bend(hinge_len=8.0, flange_area=50.0, cx=10.0, face_idx=1),
            _bend(hinge_len=12.0, flange_area=100.0, cx=90.0, face_idx=2),
        ]
        candidates = _classify_candidates(bends, PANEL_MIN_DIM)
        assert len(candidates) == 2
        assert {c["face_ids"][0] for c in candidates} == {1, 2}


class TestBoundary:
    def test_hinge_exactly_at_the_ratio_ceiling_is_admitted(self):
        hinge_len = PANEL_MIN_DIM * MAX_HINGE_LENGTH_TO_PANEL_WIDTH_RATIO
        b = _bend(hinge_len=hinge_len, flange_area=1.0)
        assert len(_classify_candidates([b], PANEL_MIN_DIM)) == 1

    def test_hinge_just_over_the_ratio_ceiling_is_excluded(self):
        hinge_len = PANEL_MIN_DIM * MAX_HINGE_LENGTH_TO_PANEL_WIDTH_RATIO + 0.01
        b = _bend(hinge_len=hinge_len, flange_area=1.0)
        assert _classify_candidates([b], PANEL_MIN_DIM) == []


class TestHonestLimitation:
    def test_ordinary_small_bent_tab_is_geometrically_identical_to_a_lance_candidate(self):
        """THE central honest finding of this spike: a genuine lance's
        hinge and an ordinary SEPARATE small bent tab (e.g. a small
        mounting ear bent up 90deg, sharing no cut-boundary relationship to
        a lance at all) produce the EXACT SAME short-hinge + small-flange
        fact pattern -- nothing in _is_bend_cylinder's or
        bend_relationships.py's real output distinguishes "this flap was
        cut from the same parent sheet on 3 sides" from "this is a
        genuinely separate small panel". Two geometrically identical
        candidate inputs, meant to represent two different real
        manufacturing features, are classified identically here -- because
        B-Rep topology alone (short bend + small far-side face) cannot tell
        them apart. This is why every candidate carries
        recognition_status='ambiguous', never 'recognized', and why this
        spike is not wired into extract()."""
        lance_hinge = _bend(hinge_len=8.0, flange_area=60.0, face_idx=1)
        separate_small_tab_hinge = _bend(hinge_len=8.0, flange_area=60.0, face_idx=1)
        lance_result = _classify_candidates([lance_hinge], PANEL_MIN_DIM)
        tab_result = _classify_candidates([separate_small_tab_hinge], PANEL_MIN_DIM)
        assert lance_result == tab_result
        assert lance_result[0]["recognition_status"] == "ambiguous"
