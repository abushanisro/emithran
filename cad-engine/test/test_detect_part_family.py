"""
Regression tests for detect_part_family() — a pure function over pre-extracted
geometric signals (no OCC/B-Rep dependency in this function itself; the real
B-Rep extraction that produces these signal values happens elsewhere).

Every case below is taken directly from detect_part_family()'s own docstring/
inline comments, which cite the real part each threshold was tuned against
(ZDR90 enclosure, a Motor Bracket regression, a 300x300x140mm sheet metal box).
These exist so a rewrite of the classifier's MECHANISM (sequential gate-and-
stop -> scored comparison, 2026-09-10) cannot silently regress a
previously-fixed real misclassification, even though the internal structure
changes completely.
"""

import pytest

from shared.component_feature_analyzer import detect_part_family


def test_very_flat_bbox_is_sheet_metal():
    # Gate 0: flatness < 0.15 is an overwhelming sheet-metal signal on its own
    # (a thin flat plate/panel with no other counter-evidence).
    family, confidence, _ = detect_part_family(
        bbox_dims=[2.0, 200.0, 300.0], hole_count=5, secondary_features_count=0,
    )
    assert family == "sheet_metal"
    assert confidence > 0.6


def test_zdr90_enclosure_cylindrical_face_dominated():
    # Cited: "ZDR90 enclosure: hole_density=0.57, flatness=0.52, cyl_alignment=0.41 -> fires here"
    family, confidence, _ = detect_part_family(
        bbox_dims=[94.6, 140.0, 182.2],
        hole_count=200,
        secondary_features_count=0,
        cyl_axis_alignment=0.41,
        total_face_count=351,  # hole_count / total_face_count ~= 0.57
        large_cyl_count=0,
    )
    assert family == "sheet_metal"


def test_zdr90_bracket_high_absolute_hole_count():
    # Cited: "ZDR90 bracket: 94.6 / 182.2 = 0.52" (gate 1b-abs, flatness < 0.60, hole_count > 20)
    family, confidence, _ = detect_part_family(
        bbox_dims=[94.6, 140.0, 182.2],
        hole_count=25,
        secondary_features_count=0,
        cyl_axis_alignment=0.20,
        total_face_count=100,
        large_cyl_count=0,
        pocket_count=0,
    )
    assert family == "sheet_metal"


def test_motor_bracket_hole_density_overrides_pocket_veto():
    # Cited Motor Bracket regression: bbox 135x165.5x70, 15 holes incl. Ø58x2 +
    # Ø70x1 motor-shaft clearance, only 26 total faces, ~9 "pockets" (bend-relief
    # artifacts, not real machined pockets). hole_density = 15/26 ~= 0.58 must
    # override the pocket veto (pocket_count > 2) and the part must NOT fall
    # through to mill_turn.
    family, confidence, _ = detect_part_family(
        bbox_dims=[70.0, 135.0, 165.5],
        hole_count=15,
        secondary_features_count=0,
        cyl_axis_alignment=0.55,  # would look rotational without the override
        total_face_count=26,
        large_cyl_count=1,  # the Ø70 motor-shaft clearance hole
        pocket_count=9,
    )
    assert family == "sheet_metal", (
        "Motor Bracket regression: high hole_density must override the pocket/large-cyl veto"
    )


def test_large_sheet_metal_box_relaxed_planar_threshold():
    # Cited: "a 300x300x140mm sheet metal box has flatness=0.47 but is clearly
    # sheet metal — the original 0.35 cutoff was too tight" (gate 1c, threshold 0.48).
    family, confidence, _ = detect_part_family(
        bbox_dims=[140.0, 300.0, 300.0],
        hole_count=3,
        secondary_features_count=0,
        cyl_axis_alignment=0.10,
        planar_face_fraction=0.75,
        total_face_count=40,
        large_cyl_count=0,
        pocket_count=0,
    )
    assert family == "sheet_metal"


def test_disc_flange_is_cnc_turned():
    family, confidence, reasons = detect_part_family(
        bbox_dims=[20.0, 100.0, 100.0],
        hole_count=4,
        secondary_features_count=0,
        cyl_axis_alignment=0.70,
        rotational_face_ratio=0.40,
        total_face_count=20,
    )
    assert family == "cnc_turned"


def test_disc_flange_with_secondary_features_is_mill_turn():
    family, confidence, reasons = detect_part_family(
        bbox_dims=[20.0, 100.0, 100.0],
        hole_count=4,
        secondary_features_count=2,
        cyl_axis_alignment=0.70,
        rotational_face_ratio=0.40,
        total_face_count=20,
    )
    assert family == "mill_turn"


def test_elongated_rod_is_cnc_turned():
    # flatness = 25/100 = 0.25 (must clear the elongation gate's flatness > 0.20
    # floor), elongation = 100/30 = 3.33 (> 2.5).
    family, confidence, reasons = detect_part_family(
        bbox_dims=[25.0, 30.0, 100.0], hole_count=0, secondary_features_count=0,
    )
    assert family == "cnc_turned"


def test_thin_shell_with_draft_is_injection_molded():
    # A molded shell: not flat enough for gate 0, not rotational enough for the
    # disc gates — thin_wall_ratio + draft_face_ratio must fire the IM gate.
    family, confidence, reasons = detect_part_family(
        bbox_dims=[40.0, 80.0, 120.0],
        hole_count=2,
        secondary_features_count=0,
        cyl_axis_alignment=0.20,
        rotational_face_ratio=0.05,
        planar_face_fraction=0.30,
        total_face_count=60,
        large_cyl_count=0,
        pocket_count=4,
        thin_wall_ratio=0.50,
        draft_face_ratio=0.40,
    )
    assert family == "injection_molded"


def test_thin_shell_with_ribs_no_draft_signal_is_injection_molded():
    # draft_face_ratio starts at 0.0 until the caller computes it — thin_wall_ratio
    # + pocket_count (ribs/bosses) alone must still fire the gate.
    family, confidence, reasons = detect_part_family(
        bbox_dims=[40.0, 80.0, 120.0],
        hole_count=2,
        secondary_features_count=0,
        cyl_axis_alignment=0.20,
        rotational_face_ratio=0.05,
        planar_face_fraction=0.30,
        total_face_count=60,
        large_cyl_count=0,
        pocket_count=4,
        thin_wall_ratio=0.50,
        draft_face_ratio=0.0,
    )
    assert family == "injection_molded"


def test_no_strong_signal_falls_back_to_cnc_milled():
    family, confidence, reasons = detect_part_family(
        bbox_dims=[50.0, 60.0, 70.0], hole_count=1, secondary_features_count=0,
    )
    assert family == "cnc_milled"


def test_insufficient_bbox_data_defaults_to_cnc_milled():
    family, confidence, reasons = detect_part_family(
        bbox_dims=[0.0, 50.0], hole_count=0, secondary_features_count=0,
    )
    assert family == "cnc_milled"
    assert confidence == 0.50


# ── The reported live bug: a thin, flat injection-molded shell ──────────────
#
# Real part reported live (2026-09-10): "TERMINAL BOX COVER VP TYPE I", real
# dims 96.5 x 6.0 x 150.0 mm (flatness = 6.0/150.0 = 0.04) — Gate 0 fires
# immediately on flatness alone, before ANY injection-molded signal (draft
# angle, wall-thickness uniformity) is ever consulted, because Gate 0 is a
# single-signal, mechanism-first decision. Any part this thin and flat that
# ALSO carries strong, unambiguous IM counter-evidence (drafted walls,
# multi-bin thin-wall clustering) must not be forced to sheet_metal on
# flatness alone anymore — the classifier must weigh both families' evidence,
# not stop at the first gate reached.
def test_thin_flat_shell_with_strong_draft_signal_is_injection_molded():
    family, confidence, reasons = detect_part_family(
        bbox_dims=[6.0, 96.5, 150.0],
        hole_count=42,
        secondary_features_count=0,
        cyl_axis_alignment=0.10,
        total_face_count=90,
        large_cyl_count=0,
        pocket_count=0,
        thin_wall_ratio=0.55,
        draft_face_ratio=0.45,
    )
    assert family == "injection_molded", (
        "A thin flat shell with strong drafted-wall evidence must not be forced "
        "to sheet_metal by flatness alone"
    )


def test_thin_flat_shell_with_no_im_signal_stays_sheet_metal():
    # Same extreme flatness, but with NONE of the IM counter-evidence supplied
    # (draft_face_ratio/thin_wall_ratio both 0, the honest "caller doesn't
    # compute this yet" default) — must still classify sheet_metal, exactly as
    # today, since there is no real evidence to weigh against flatness.
    family, confidence, reasons = detect_part_family(
        bbox_dims=[6.0, 96.5, 150.0],
        hole_count=42,
        secondary_features_count=0,
        cyl_axis_alignment=0.10,
        total_face_count=90,
        large_cyl_count=0,
        pocket_count=0,
    )
    assert family == "sheet_metal"
