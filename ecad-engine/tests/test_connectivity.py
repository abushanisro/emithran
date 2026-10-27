"""Copper reverse engineering on the smallest possible hand-made inputs.

These shapes and strings exercise the geometry and tracing only; they are not sample boards. A real set is verified by
uploading it (the two OPT boards: 89 chains of 6 LEDs + 1 resistor, and 12 chains of 7 THT LEDs + 1 resistor per board).
"""
from __future__ import annotations

import math

import pytest

from extraction.connectivity import ClearPolarity, CopperLayer, analyse, copper_shapes
from extraction.geometry import capsule, connect, gap, min_clearance, polygon, rectangle, union_area
from extraction.placements import Component
from parsers.excellon import Hole
from parsers.gerber_layer import load_gerber

HEADER = "%FSLAX24Y24*%\n%MOMM*%\n"


def layer(body: str):
    return load_gerber("t.gtl", (HEADER + body + "M02*\n").encode())


# ---------------------------------------------------------------------------------------------------- geometry
def test_two_strokes_that_overlap_touch_and_two_apart_do_not():
    a = capsule(0, 0, 10, 0, 0.5)
    assert gap(a, capsule(5, 0.9, 5, 5, 0.5)) < 0
    assert gap(a, capsule(5, 2.0, 5, 5, 0.5)) == pytest.approx(1.0)  # 2.0 between centre lines, minus both radii


def test_a_stroke_ending_inside_a_pad_touches_it():
    pad = rectangle(10, 0, 2, 2)
    assert gap(capsule(0, 0, 10, 0, 0.1), pad) <= 0
    assert gap(capsule(0, 3, 10, 3, 0.1), pad) == pytest.approx(1.9)


def test_a_rotated_pad_is_a_rotated_polygon():
    pad = rectangle(0, 0, 4, 1, math.radians(90))
    xs = sorted(round(p[0], 6) for p in pad.pts)
    assert xs[0] == -0.5 and xs[-1] == 0.5


def test_union_area_counts_overlap_once():
    a, b = rectangle(0, 0, 10, 10), rectangle(5, 0, 10, 10)
    assert union_area([a, b], 0.01) == pytest.approx(150.0, rel=1e-3)
    assert union_area([capsule(0, 0, 0, 0, 1.0)], 0.005) == pytest.approx(math.pi, rel=1e-3)


def test_layers_are_joined_only_through_a_hole_not_by_overlapping_in_plan():
    top, bottom = capsule(0, 0, 10, 0, 0.5, "t"), capsule(0, 0, 10, 0, 0.5, "b")
    uf = connect([top, bottom])
    assert uf.find(0) != uf.find(1)


def test_clearance_is_measured_between_different_nets_only():
    shapes = [capsule(0, 0, 10, 0, 0.1, "t"), capsule(0, 0.5, 10, 0.5, 0.1, "t"), capsule(10, 0, 10, 0.5, 0.1, "t")]
    uf = connect(shapes)
    assert min_clearance(shapes, [uf.find(i) for i in range(3)], 1.0) is None  # all one conductor
    found = min_clearance(shapes[:2], [0, 1], 1.0)
    assert found is not None and found[0] == pytest.approx(0.3)


# ---------------------------------------------------------------------------------------------------- Gerber input
def test_flashes_strokes_and_regions_become_shapes():
    shapes = copper_shapes(layer("%ADD10C,0.20*%\n%ADD11R,1.0X2.0*%\nD10*\nX0Y0D02*\nX100000Y0D01*\nD11*\nX0Y0D03*\nG36*\nX0Y50000D02*\nX10000Y50000D01*\nX10000Y60000D01*\nX0Y60000D01*\nX0Y50000D01*\nG37*\n"), "t")
    kinds = sorted((s.kind, s.flash) for s in shapes)
    assert kinds == [("cap", False), ("poly", False), ("poly", True)]


def test_clear_polarity_is_refused_not_traced():
    with pytest.raises(ClearPolarity):
        copper_shapes(layer("%ADD10C,0.20*%\n%LPC*%\nD10*\nX0Y0D03*\n"), "t")


# ---------------------------------------------------------------------------------------------------- circuits
def _strip(n_led: int, holes: bool):
    """n LEDs and one resistor in series between two rails, pads 2 mm apart, one part every 5 mm along x."""
    top: list = []
    comps: list[Component] = []
    hole_list: list[Hole] = []
    parts = [("D", "LED") for _ in range(n_led)] + [("R", "RES")]
    for k, (prefix, fp) in enumerate(parts):
        x = 5.0 * (k + 1)
        comps.append(Component(f"{prefix}{k}", "", fp, "top", x, 0.0, 0.0))
        for dx in (-1.0, 1.0):
            top.append(rectangle(x + dx, 0, 1.0, 1.0, layer="t.gtl", flash=True))
            if holes and fp == "LED":
                hole_list.append(Hole(x + dx, 0.0, 0.6, True, 1))
        if k:
            top.append(capsule(x - 4.0, 0, x - 1.0, 0, 0.2, "t.gtl"))  # previous part's right pad to this part's left pad
    first, last = 5.0, 5.0 * len(parts)
    top.append(capsule(first - 1.0, 0, first - 1.0, 10, 0.4, "t.gtl"))  # rail +
    top.append(capsule(last + 1.0, 0, last + 1.0, -10, 0.4, "t.gtl"))  # rail -
    return [CopperLayer("t.gtl", "top", top), CopperLayer("b.gbl", "bottom", [])], hole_list, comps


def test_a_series_string_is_found_with_its_composition():
    layers, holes, comps = _strip(6, holes=False)
    result = analyse(layers, holes, comps, [])
    chains = result.connectivity["seriesChains"]
    assert chains == [{"count": 1, "partsPerChain": 7, "composition": [{"footprint": "LED", "count": 6}, {"footprint": "RES", "count": 1}]}]
    assert result.mount == {"LED": ("smd", 2), "RES": ("smd", 2)}


def test_pins_on_plated_holes_make_a_footprint_through_hole():
    layers, holes, comps = _strip(3, holes=True)
    result = analyse(layers, holes, comps, [])
    assert result.mount["LED"] == ("tht", 2) and result.mount["RES"] == ("smd", 2)
    assert result.copper["viaCount"] == 0  # every hole is a part's pin


def test_a_hole_that_belongs_to_no_part_is_a_via():
    layers, holes, comps = _strip(2, holes=False)
    layers[0].shapes.append(capsule(30, 5, 30, 5, 0.45, "t.gtl", flash=True))
    holes = [Hole(30, 5, 0.3, True, 1)]
    result = analyse(layers, holes, comps, [])
    assert result.copper["viaCount"] == 1
    assert result.min_annular_ring_mm == pytest.approx(0.3)


def test_copper_to_edge_is_measured_to_the_outline_centre_line():
    layers, holes, comps = _strip(2, holes=False)
    result = analyse(layers, holes, comps, [(-1.0, -20.0, -1.0, 20.0)])
    assert result.min_copper_to_edge_mm == pytest.approx(4.5)  # first pad edge at x = 3.5, outline at x = -1
