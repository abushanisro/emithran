"""Narrowest-trace and smallest-hole measurement on the smallest possible hand-written layers.

These strings exercise the measuring functions only; they are not sample boards. A real set is verified by uploading it.
"""
from __future__ import annotations

from extraction.fabrication import measure_trace_width, smallest_hole_mm
from parsers.excellon import Hole
from parsers.gerber_layer import load_gerber

HEADER = "%FSLAX24Y24*%\n%MOMM*%\n"


def layer(body: str):
    return load_gerber("t.gtl", (HEADER + body + "M02*\n").encode())


def test_narrowest_stroke_is_the_smallest_circular_aperture_drawn():
    trace = measure_trace_width(layer("%ADD10C,0.25*%\n%ADD11C,0.15*%\nD10*\nX0Y0D02*\nX100000Y0D01*\nD11*\nX0Y10000D02*\nX100000Y10000D01*\n"))
    assert trace.min_width_mm == 0.15 and trace.strokes == 2 and trace.skipped == 0


def test_an_aperture_that_is_only_flashed_is_a_pad_not_a_trace():
    trace = measure_trace_width(layer("%ADD10C,0.10*%\n%ADD11C,0.30*%\nD10*\nX0Y0D03*\nD11*\nX0Y0D02*\nX100000Y0D01*\n"))
    assert trace.min_width_mm == 0.3


def test_a_layer_with_no_strokes_has_no_trace_width():
    trace = measure_trace_width(layer("%ADD10C,0.30*%\nD10*\nX0Y0D03*\n"))
    assert trace.min_width_mm is None and trace.strokes == 0


def test_a_rectangular_stroke_is_skipped_not_guessed():
    trace = measure_trace_width(layer("%ADD10R,0.20X0.40*%\nD10*\nX0Y0D02*\nX100000Y0D01*\n"))
    assert trace.min_width_mm is None and trace.skipped == 1


def test_smallest_hole_is_the_minimum_diameter_over_all_tools():
    holes = [Hole(0, 0, 0.8, True, 1), Hole(1, 1, 0.3, True, 2), Hole(2, 2, 3.2, False, 3)]
    assert smallest_hole_mm(holes) == 0.3
    assert smallest_hole_mm([]) is None
