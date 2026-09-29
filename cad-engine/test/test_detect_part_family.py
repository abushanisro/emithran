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
    assert family == "turned"


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
    assert family == "turned"


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
    assert family == "plastic_molded"


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
    assert family == "plastic_molded"


def test_no_strong_signal_falls_back_to_cnc_milled():
    family, confidence, reasons = detect_part_family(
        bbox_dims=[50.0, 60.0, 70.0], hole_count=1, secondary_features_count=0,
    )
    assert family == "milled"


def test_insufficient_bbox_data_defaults_to_cnc_milled():
    family, confidence, reasons = detect_part_family(
        bbox_dims=[0.0, 50.0], hole_count=0, secondary_features_count=0,
    )
    assert family == "milled"
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
    assert family == "plastic_molded", (
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


# ── The reported live bug: a small machined block, hole-dense but with the
# "holes" themselves being large-radius cylinders, not perforations ─────────
#
# Real part reported live (2026-09-17): 10003.stp, real bbox 17.6 x 17.6 x
# 3.0mm, uploaded into a Sheet Metal Assembly BOM. Real signals from the
# actual log line: hole_count=81, large_cyl_count=80, total_face_count=124
# (hole_density=0.653), flatness=0.17, pocket_count=3, thin_wall_ratio=0.0.
# Misclassified sheet_metal at 0.81 confidence via Gate 1b ("High hole
# density... Perforated sheet metal — hole-dominated topology").
#
# Root cause: sheet_metal_veto's large-cylinder branch only fired when
# hole_density < 0.20 — a guard tuned against a SPARSE part with a few
# oversized holes (the cited motor-bracket case: large_cyl_count=1,
# hole_count=15, ratio ~7%). It had no defense against a DENSE part where
# the large cylinders themselves make up nearly the entire hole count (here,
# 80 of the 81 counted "holes" are large-radius cylindrical faces — ratio
# ~99%) — hole_density=0.653 cleared the >=0.20 bar meant to protect only
# genuinely small perforations, when there were almost no small holes on
# this part at all.
def test_dense_large_cylinder_block_is_not_sheet_metal():
    family, confidence, reasons = detect_part_family(
        bbox_dims=[17.6, 17.6, 3.0],
        hole_count=81,
        secondary_features_count=3,  # pocket_count folded in, as the real caller does
        cyl_axis_alignment=0.10,     # no rotational evidence supplied — isolates the veto fix
        total_face_count=124,
        large_cyl_count=80,
        pocket_count=3,
        thin_wall_ratio=0.0,
    )
    assert family != "sheet_metal", (
        "A part whose 'holes' are ~99% large-radius cylinders (80/81) cannot be "
        "perforated sheet metal regardless of how hole-dense it looks — the veto "
        "must fire on the large-cylinder RATIO, not just on overall hole_density"
    )
    # No rotational or IM evidence supplied (see cyl_axis_alignment/thin_wall_ratio
    # above) — falls through to the honest catch-all, not a fabricated guess.
    assert family == "milled"


def test_large_cylinder_ratio_veto_does_not_regress_motor_bracket():
    # Same shape of evidence as test_motor_bracket_hole_density_overrides_pocket_veto
    # above, re-asserted here to make the new veto branch's boundary explicit:
    # large_cyl_count=1 / hole_count=15 is a ~7% ratio, nowhere near the new
    # 50% threshold, so the original sheet-metal classification must be unchanged.
    family, confidence, _ = detect_part_family(
        bbox_dims=[70.0, 135.0, 165.5],
        hole_count=15,
        secondary_features_count=0,
        cyl_axis_alignment=0.55,
        total_face_count=26,
        large_cyl_count=1,
        pocket_count=9,
    )
    assert family == "sheet_metal", (
        "The new large-cylinder-ratio veto branch must not fire on a low ratio (~7%)"
    )


def test_large_cylinder_ratio_veto_boundary_just_under_50_percent():
    # 3 large cylinders out of 7 holes = ~43%, under the 50% threshold — the
    # ORIGINAL hole_density<0.20 branch also doesn't fire (hole_density here
    # is high), so this part must still classify as sheet metal: proves the
    # new branch has a real, deliberate boundary rather than firing on any
    # nonzero large-cylinder presence.
    family, confidence, _ = detect_part_family(
        bbox_dims=[50.0, 200.0, 220.0],
        hole_count=7,
        secondary_features_count=0,
        cyl_axis_alignment=0.10,
        total_face_count=20,  # hole_density = 7/20 = 0.35
        large_cyl_count=3,    # > 3 required by the veto's outer condition is FALSE here (3 is not > 3)
        pocket_count=0,
    )
    assert family == "sheet_metal"


def test_large_cylinder_ratio_veto_fires_just_over_50_percent():
    # 5 large cylinders out of 9 holes = ~56%, and large_cyl_count=5 > 3 —
    # both conditions of the new branch are satisfied, so the veto must fire
    # even though hole_density (9/20=0.45) is well above the original 0.20 bar.
    family, confidence, reasons = detect_part_family(
        bbox_dims=[17.6, 17.6, 3.0],
        hole_count=9,
        secondary_features_count=0,
        cyl_axis_alignment=0.10,
        total_face_count=20,
        large_cyl_count=5,
        pocket_count=0,
    )
    assert family != "sheet_metal"
