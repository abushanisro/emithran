"""
Rolled-form detection tests.

Real B-Rep throughout — no synthetic-dict-only verification, and no STEP file
(none exists anywhere in this repo). The rolled shell is built in memory the
same way test_bend_relationships.make_bent_sheet builds a bent sheet: a
rectangular profile swept along an arc with BRepOffsetAPI_MakePipe. That is the
established convention here.

The point of these tests is the boundary the whole module rests on: a press
brake cannot wrap material past a half turn in one hit, so a single cylindrical
face that sweeps past 180 degrees is rolled, and one that does not is not
separable from a crease on this evidence alone.
"""

import math

import pytest

pytest.importorskip("OCC")

from OCC.Core.BRepBuilderAPI import (  # noqa: E402
    BRepBuilderAPI_MakeEdge,
    BRepBuilderAPI_MakeFace,
    BRepBuilderAPI_MakeWire,
)
from OCC.Core.BRepAlgoAPI import BRepAlgoAPI_Cut  # noqa: E402
from OCC.Core.BRepOffsetAPI import BRepOffsetAPI_MakePipe  # noqa: E402
from OCC.Core.BRepPrimAPI import BRepPrimAPI_MakeCylinder  # noqa: E402
from OCC.Core.GC import GC_MakeArcOfCircle  # noqa: E402
from OCC.Core.gp import gp_Ax2, gp_Circ, gp_Dir, gp_Pnt  # noqa: E402

from sheet_metal.features.rolled_form import (  # noqa: E402
    count_recognized,
    detect_rolled_forms,
    max_bend_radius_mm,
    min_bend_line_mm,
)
from shared.memory_optimizer import AdvancedCADMemoryOptimizer  # noqa: E402

THICKNESS_MM = 2.0
WIDTH_MM = 60.0
SHEET_NORMAL = (0.0, 1.0, 0.0)  # the sweep profile lies in the XZ plane


def make_rolled_shell(radius_mm, sweep_deg, thickness_mm=THICKNESS_MM, width_mm=WIDTH_MM):
    """A sheet rolled to one continuous curvature, modelled the canonical way:
    a partial cylinder shelled to sheet thickness. Its cylindrical faces carry
    the true sweep in their U parametrisation (verified: 300 deg reads 300 deg)."""
    ax = gp_Ax2(gp_Pnt(0, 0, 0), gp_Dir(0, 0, 1))
    angle_rad = math.radians(sweep_deg)
    outer = BRepPrimAPI_MakeCylinder(ax, radius_mm + thickness_mm / 2, width_mm, angle_rad).Shape()
    inner = BRepPrimAPI_MakeCylinder(ax, radius_mm - thickness_mm / 2, width_mm, angle_rad).Shape()
    return BRepAlgoAPI_Cut(outer, inner).Shape()


def make_swept_shell(radius_mm, sweep_deg, thickness_mm=THICKNESS_MM, width_mm=WIDTH_MM):
    """The SAME rolled shell built by sweeping a profile along an arc. Included
    deliberately: this construction parametrises U the other way round and
    reports the complement of the sweep — see the module's own
    "A VERIFIED LIMIT OF THE SWEEP SIGNAL" section."""
    sweep_rad = math.radians(sweep_deg)
    circ = gp_Circ(gp_Ax2(gp_Pnt(0, 0, 0), gp_Dir(0, 1, 0)), radius_mm)
    start_pt = gp_Pnt(radius_mm, 0, 0)
    end_pt = gp_Pnt(radius_mm * math.cos(sweep_rad), 0, radius_mm * math.sin(sweep_rad))
    spine = BRepBuilderAPI_MakeWire(
        BRepBuilderAPI_MakeEdge(GC_MakeArcOfCircle(circ, start_pt, end_pt, True).Value()).Edge()
    ).Wire()
    p1 = gp_Pnt(radius_mm - thickness_mm / 2, -width_mm / 2, 0)
    p2 = gp_Pnt(radius_mm + thickness_mm / 2, -width_mm / 2, 0)
    p3 = gp_Pnt(radius_mm + thickness_mm / 2, width_mm / 2, 0)
    p4 = gp_Pnt(radius_mm - thickness_mm / 2, width_mm / 2, 0)
    profile = BRepBuilderAPI_MakeFace(
        BRepBuilderAPI_MakeWire(
            BRepBuilderAPI_MakeEdge(p1, p2).Edge(),
            BRepBuilderAPI_MakeEdge(p2, p3).Edge(),
            BRepBuilderAPI_MakeEdge(p3, p4).Edge(),
            BRepBuilderAPI_MakeEdge(p4, p1).Edge(),
        ).Wire()
    ).Face()
    pipe = BRepOffsetAPI_MakePipe(spine, profile)
    pipe.Build()
    assert pipe.IsDone(), "pipe sweep failed"
    return pipe.Shape()


def cylinders_of(shape):
    """The same raw 11-tuples feature_extractor.extract() is handed —
    _detect_holes_real is where memory_optimizer builds them."""
    from OCC.Core.Bnd import Bnd_Box
    from OCC.Core.BRepBndLib import brepbndlib

    box = Bnd_Box()
    brepbndlib.Add(shape, box)
    xmin, ymin, zmin, xmax, ymax, zmax = box.Get()
    bbox = {"xmin": xmin, "ymin": ymin, "zmin": zmin, "xmax": xmax, "ymax": ymax, "zmax": zmax}

    optimizer = AdvancedCADMemoryOptimizer()
    holes = optimizer._detect_holes_real(shape, bbox)  # noqa: SLF001
    return holes.get("raw_cylinders_full", []) or []


# ── Real B-Rep ────────────────────────────────────────────────────────────────

def test_real_rolled_shell_past_half_turn_is_recognized():
    cyls = cylinders_of(make_rolled_shell(radius_mm=100.0, sweep_deg=300.0))
    assert cyls, "expected the swept shell to produce cylindrical faces"

    found = detect_rolled_forms(cyls, THICKNESS_MM)
    recognized = [f for f in found if f["recognition_status"] == "recognized"]
    assert recognized, f"a 300 deg rolled shell must be recognised; got {found}"
    assert count_recognized(found) >= 1
    assert max(f["sweep_deg"] for f in recognized) > 180.0
    assert "bend-radius ceiling" in recognized[0]["recognition_evidence"]


def test_real_rolled_shell_is_invisible_to_the_bend_detector_it_bypasses():
    """The reason this module reads raw tuples: these faces are rejected by the
    bend gates, which is why a rolled part reports zero bends today."""
    cyls = cylinders_of(make_rolled_shell(radius_mm=100.0, sweep_deg=300.0))
    cap = max_bend_radius_mm(THICKNESS_MM)  # max(8*2, 20) = 20mm

    rolled = [c for c in cyls if len(c) > 10 and c[10] is not None and abs(float(c[10])) > math.pi]
    assert rolled, "expected at least one face sweeping past a half turn"
    for c in rolled:
        assert float(c[0]) > cap, "radius should also exceed the bend-radius ceiling"


def test_real_gentle_arc_within_press_brake_sweep_is_never_a_confident_detection():
    # 90 deg at R100 on 2mm: too large a radius to be called a bend, but well
    # within what a press brake can sweep. Genuinely ambiguous, and reported so.
    cyls = cylinders_of(make_rolled_shell(radius_mm=100.0, sweep_deg=90.0))
    found = detect_rolled_forms(cyls, THICKNESS_MM)

    assert count_recognized(found) == 0
    assert found and all(f["recognition_status"] == "ambiguous" for f in found), found


def test_a_swept_construction_hides_the_sweep_and_degrades_to_ambiguous():
    """A verified, documented limit — not a wish. The same 300 deg shell built by
    sweeping a profile along an arc parametrises U the other way and reports the
    COMPLEMENT (60 deg). It must therefore fall back to the radius evidence and
    report 'ambiguous', never a confident 60 deg press-brake bend."""
    cyls = cylinders_of(make_swept_shell(radius_mm=100.0, sweep_deg=300.0))
    sweeps = [round(math.degrees(abs(float(c[10]))), 1) for c in cyls if len(c) > 10 and c[10] is not None]
    assert sweeps and max(sweeps) < 180.0, f"expected the complement, got {sweeps}"

    found = detect_rolled_forms(cyls, THICKNESS_MM)
    assert count_recognized(found) == 0
    assert found and all(f["recognition_status"] == "ambiguous" for f in found)


def test_a_real_hole_is_excluded_by_the_bend_line_length_rule():
    """A hole is one sheet thickness deep, so it can never reach the minimum
    bend-line length — which is how holes stay out without a sheet normal."""
    from OCC.Core.BRepPrimAPI import BRepPrimAPI_MakeBox

    plate = BRepPrimAPI_MakeBox(gp_Pnt(-60, -60, 0), 120, 120, THICKNESS_MM).Shape()
    drill = BRepPrimAPI_MakeCylinder(
        gp_Ax2(gp_Pnt(0, 0, -1), gp_Dir(0, 0, 1)), 25.0, THICKNESS_MM + 2
    ).Shape()
    holed = BRepAlgoAPI_Cut(plate, drill).Shape()

    cyls = cylinders_of(holed)
    assert cyls, "expected the drilled hole to produce a cylindrical face"
    # R25 is over the 20mm bend-radius ceiling, so only the length rule can
    # keep it out — exactly the case that would otherwise be a false positive.
    assert max(float(c[0]) for c in cyls) > max_bend_radius_mm(THICKNESS_MM)
    assert detect_rolled_forms(cyls, THICKNESS_MM) == []


# ── The rule itself ──────────────────────────────────────────────────────────

def cyl(radius_mm, sweep_rad, axis=(0.0, 1.0, 0.0), axial_len=60.0, face_idx=7):
    """A raw tuple in memory_optimizer's shape:
    (r, axis_z, cx, cy, cz, ax, ay, az, face_idx, v_range, u_range_rad)."""
    return (radius_mm, axis[2], 0.0, 0.0, 0.0, axis[0], axis[1], axis[2],
            face_idx, axial_len, sweep_rad)


def test_ordinary_press_brake_bend_is_not_a_rolled_form():
    # R3 on 2mm sheet, 90 deg — a textbook crease. In-plane axis (X), so it is
    # not filtered out as a hole; it must simply not be a rolled-form candidate.
    found = detect_rolled_forms([cyl(3.0, math.radians(90), axis=(1.0, 0.0, 0.0))],
                                THICKNESS_MM)
    assert found == []


def test_a_hole_is_never_a_rolled_form_however_it_sweeps():
    # A hole is a full 360 deg cylinder, but it is only ONE SHEET THICKNESS
    # deep — below the minimum bend-line length, whatever its radius.
    found = detect_rolled_forms([cyl(50.0, 2 * math.pi, axial_len=THICKNESS_MM)], THICKNESS_MM)
    assert found == []


def test_a_tube_deeper_than_a_bend_line_is_a_rolled_form_not_a_hole():
    # The same 360 deg face 60mm deep in 2mm sheet is not a hole through the
    # sheet — it is rolled material, and reporting it as such is correct.
    found = detect_rolled_forms([cyl(50.0, 2 * math.pi, axial_len=60.0)], THICKNESS_MM)
    assert count_recognized(found) == 1


def test_a_bend_that_wraps_past_half_a_turn_is_still_not_a_rolled_form():
    """THE FALSE POSITIVE THIS MODULE WAS CAUGHT ON. An ordinary bracket bend can
    genuinely span more than 180 deg when the bend is modelled on the major arc
    — measured on real B-Rep, area-confirmed, not a parametrisation artefact. So
    sweep alone must never be enough; the radius has to be beyond anything a
    press brake forms."""
    found = detect_rolled_forms([cyl(4.0, math.radians(270), axis=(1.0, 0.0, 0.0))],
                                THICKNESS_MM)
    assert found == [], "R4 on 2mm sheet is a press-brake bend however far it wraps"


def test_a_real_two_bend_bracket_reports_no_rolled_form_end_to_end():
    """The same regression through the real extractor path: make_bent_sheet's
    R2/R4 bends genuinely produce 270 deg faces, and none of them may be
    reported as rolled."""
    import importlib.util
    spec = importlib.util.spec_from_file_location("tbr", "test/test_bend_relationships.py")
    tbr = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(tbr)

    cyls = cylinders_of(tbr.make_bent_sheet([30, 30, 30], [90, -90]))
    wrapping = [c for c in cyls if len(c) > 10 and c[10] and abs(float(c[10])) > math.pi]
    assert wrapping, "fixture precondition: these bend faces really do span >180 deg"
    assert detect_rolled_forms(cyls, tbr.THICKNESS_MM) == []


def test_a_large_radius_wrap_is_recognized():
    found = detect_rolled_forms([cyl(100.0, math.radians(270), axis=(1.0, 0.0, 0.0))],
                                THICKNESS_MM)
    assert count_recognized(found) == 1


def test_the_radius_ceiling_tracks_thickness():
    # max(8*t, 20). At 1.5mm that is 20mm; at 5mm it is 40mm.
    assert max_bend_radius_mm(1.5) == 20.0
    assert max_bend_radius_mm(5.0) == 40.0

    # R30 / 90 deg is ambiguous on thin sheet (over the 20mm ceiling)...
    thin = detect_rolled_forms([cyl(30.0, math.radians(90), axis=(1.0, 0.0, 0.0))], 1.5)
    assert [f["recognition_status"] for f in thin] == ["ambiguous"]
    # ...and not a candidate at all on 5mm sheet, where R30 is a normal bend.
    thick = detect_rolled_forms([cyl(30.0, math.radians(90), axis=(1.0, 0.0, 0.0))], 5.0)
    assert thick == []


def test_legacy_tuples_without_an_angular_extent_are_skipped_not_guessed():
    legacy_9 = (100.0, 0.0, 0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 3)
    assert detect_rolled_forms([legacy_9], THICKNESS_MM) == []
    no_sweep = (100.0, 0.0, 0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 3, 60.0, None)
    assert detect_rolled_forms([no_sweep], THICKNESS_MM) == []


def test_returns_nothing_rather_than_failing_on_absent_inputs():
    assert detect_rolled_forms([], THICKNESS_MM) == []
    assert detect_rolled_forms([cyl(100.0, 2 * math.pi)], 0.0) == []


def test_candidate_carries_the_geometry_a_consumer_needs():
    found = detect_rolled_forms([cyl(120.0, math.radians(300), axis=(1.0, 0.0, 0.0), axial_len=75.0)],
                                THICKNESS_MM)
    assert len(found) == 1
    c = found[0]
    assert c["radius_mm"] == 120.0
    assert c["sweep_deg"] == 300.0
    assert c["axial_length_mm"] == 75.0
    assert c["face_ids"] == [7]
