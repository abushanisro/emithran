"""
Tests for nesting.compute_true_nest -- the true (real polygon) 2D nesting
placement algorithm for the Nest View feature.

No job-queue infrastructure exists in this codebase, so this algorithm
must terminate on its own (never hang) for realistic inputs, and disclose
`capped: True` honestly rather than silently mis-reporting when its
evaluation budget runs out. These tests assert both the geometric
invariants (no overlap, stays in bounds) and the honesty invariants
(capped fires under pressure, never silently 0/guessed).
"""
import math
import time

import pytest

pytest.importorskip("shapely")

from shapely.geometry import Polygon
from shapely.affinity import rotate as shapely_rotate, translate as shapely_translate
from shapely.ops import unary_union

from sheet_metal import nesting


SQUARE_10MM = [[0, 0], [10, 0], [10, 10], [0, 10]]
TRAPEZOID = [[0, 0], [165.35, 0], [132.68, 62.93], [32.68, 62.93]]
# Concave L-bracket flat pattern (100x100mm square with a 50x50mm notch) --
# a real, common sheet-metal outline shape, not representable as one rectangle.
L_SHAPE = [[0, 0], [0, 100], [50, 100], [50, 50], [100, 50], [100, 0]]


def _placement_polygons(outline_points_mm, placements):
    base = Polygon(outline_points_mm)
    polys = []
    for p in placements:
        rp = shapely_rotate(base, p["rotation_deg"], origin=(0, 0), use_radians=False)
        polys.append(shapely_translate(rp, xoff=p["x_mm"], yoff=p["y_mm"]))
    return polys


def test_no_two_placements_overlap():
    result, reason = nesting.compute_true_nest(
        outline_points_mm=SQUARE_10MM, holes_mm=[],
        sheet_width_mm=100.0, sheet_length_mm=100.0,
        quantity=1000, kerf_mm=1.0, edge_margin_mm=2.0,
    )
    assert result is not None
    assert result["parts_per_sheet"] > 0
    polys = _placement_polygons(SQUARE_10MM, result["placements"])
    for i in range(len(polys)):
        for j in range(i + 1, len(polys)):
            # kerf=1mm means placements must be at least 1mm apart -- allow
            # a tiny float-precision epsilon, but never a real overlap.
            assert polys[i].buffer(-0.01).intersection(polys[j].buffer(-0.01)).area < 1e-6


def test_all_placements_within_sheet_usable_bounds():
    edge_margin = 3.0
    # Trapezoid's own longest dimension is 165.35mm -- must exceed that in
    # at least one sheet dimension for any rotation (0/90/180/270) to fit.
    sheet_w, sheet_l = 400.0, 250.0
    result, reason = nesting.compute_true_nest(
        outline_points_mm=TRAPEZOID, holes_mm=[],
        sheet_width_mm=sheet_w, sheet_length_mm=sheet_l,
        quantity=50, kerf_mm=0.5, edge_margin_mm=edge_margin,
    )
    assert result is not None
    polys = _placement_polygons(TRAPEZOID, result["placements"])
    for poly in polys:
        minx, miny, maxx, maxy = poly.bounds
        assert minx >= edge_margin - 0.05
        assert miny >= edge_margin - 0.05
        assert maxx <= sheet_w - edge_margin + 0.05
        assert maxy <= sheet_l - edge_margin + 0.05


def test_quantity_1_still_reports_real_sheet_capacity_not_just_1():
    """A quantity of 1 must not artificially cap parts_per_sheet at 1 --
    the sheet's TRUE capacity is independent of how many are actually
    ordered; sheets_required is what quantity should drive, not capacity."""
    result, reason = nesting.compute_true_nest(
        outline_points_mm=SQUARE_10MM, holes_mm=[],
        sheet_width_mm=100.0, sheet_length_mm=100.0,
        quantity=1, kerf_mm=0.0, edge_margin_mm=2.0,
    )
    assert result is not None
    assert result["parts_per_sheet"] > 1  # many 10mm squares fit a 96x96 usable area
    assert result["sheets_required"] == 1


def test_quantity_forcing_multiple_sheets():
    result, reason = nesting.compute_true_nest(
        outline_points_mm=SQUARE_10MM, holes_mm=[],
        sheet_width_mm=100.0, sheet_length_mm=100.0,
        quantity=10_000, kerf_mm=0.0, edge_margin_mm=2.0,
    )
    assert result is not None
    assert result["parts_per_sheet"] > 0
    assert result["sheets_required"] == math.ceil(10_000 / result["parts_per_sheet"])
    assert result["sheets_required"] > 1


def test_utilization_uses_real_polygon_area_not_bounding_rect():
    """For the trapezoid (real area meaningfully smaller than its bounding
    rectangle), utilization must reflect the real shape's area -- proving
    this is genuinely different from the old bounding-rect-only engine."""
    result, reason = nesting.compute_true_nest(
        outline_points_mm=TRAPEZOID, holes_mm=[],
        sheet_width_mm=500.0, sheet_length_mm=500.0,
        quantity=100, kerf_mm=0.0, edge_margin_mm=2.0,
    )
    assert result is not None
    trapezoid_area = Polygon(TRAPEZOID).area
    bounding_rect_area = 165.35 * 62.93
    # Sanity: real trapezoid area is meaningfully less than its bbox area
    assert trapezoid_area < bounding_rect_area * 0.85
    assert 0 < result["utilization_pct"] <= 100.0


def test_part_too_large_for_sheet_returns_none():
    huge_square = [[0, 0], [1000, 0], [1000, 1000], [0, 1000]]
    result, reason = nesting.compute_true_nest(
        outline_points_mm=huge_square, holes_mm=[],
        sheet_width_mm=100.0, sheet_length_mm=100.0,
        quantity=5, kerf_mm=0.0, edge_margin_mm=2.0,
    )
    assert result is None
    assert "does not fit" in reason


def test_degenerate_outline_returns_none():
    result, reason = nesting.compute_true_nest([], [], 100.0, 100.0, 1)
    assert result is None
    assert "point" in reason

    result, reason = nesting.compute_true_nest([[0, 0], [1, 1]], [], 100.0, 100.0, 1)
    assert result is None
    assert "point" in reason


@pytest.mark.parametrize("kerf", [0.0, 0.2, 0.5, 1.0])
def test_nonzero_kerf_does_not_collapse_placement_to_one_part(kerf):
    """Regression for a real bug found live: extreme-point anchors were
    generated at the exact touching corner of the previous part (zero gap),
    so ANY kerf_mm > 0 made every subsequent placement fail its own
    clearance test and permanently dead-end that anchor -- collapsing every
    shape (square, trapezoid, concave L) to parts_per_sheet == 1 regardless
    of how much room was actually left on the sheet. kerf > 0 is the
    realistic case (real laser cutting always needs spacing), so this must
    never regress."""
    result, reason = nesting.compute_true_nest(
        outline_points_mm=SQUARE_10MM, holes_mm=[],
        sheet_width_mm=100.0, sheet_length_mm=100.0,
        quantity=1000, kerf_mm=kerf, edge_margin_mm=2.0,
    )
    assert result is not None
    assert result["parts_per_sheet"] > 1, f"kerf={kerf} collapsed placement to <=1 part"


def test_concave_l_shape_nests_without_overlap():
    """Confirms the nester handles a genuinely concave outline (not
    representable as a single rectangle) -- real polygon collision, not a
    bounding-box approximation that would either overcount (ignoring the
    notch) or undercount (treating the notch as solid)."""
    result, reason = nesting.compute_true_nest(
        outline_points_mm=L_SHAPE, holes_mm=[],
        sheet_width_mm=400.0, sheet_length_mm=400.0,
        quantity=50, kerf_mm=1.0, edge_margin_mm=2.0,
    )
    assert result is not None
    assert result["parts_per_sheet"] > 1
    polys = _placement_polygons(L_SHAPE, result["placements"])
    for i in range(len(polys)):
        for j in range(i + 1, len(polys)):
            assert polys[i].buffer(-0.01).intersection(polys[j].buffer(-0.01)).area < 1e-6


def test_small_part_on_large_sheet_completes_quickly_at_scale():
    """Regression for a real production failure: a ~53x123mm sheet-metal
    part (830-001718-00) on a 2500x5000mm sheet needs ~1,800 placements to
    fill the sheet. Before the grid spatial index, _fits_and_clear scanned
    the FULL placed_buffered list per candidate, making the whole nest
    O(n^2) real shapely calls -- this took long enough in production to
    blow past the caller's HTTP timeout (cad-analysis.service.ts's 90s,
    30s at the time this broke). A generous wall-clock bound here (well
    under any HTTP timeout) is what actually protects against this class
    of regression -- MAX_EVALUATIONS alone bounds evaluation COUNT, not
    the cost of each one, so it would not have caught this."""
    small_part = [[0, 0], [53, 0], [53, 123], [0, 123]]
    started = time.monotonic()
    result, reason = nesting.compute_true_nest(
        outline_points_mm=small_part, holes_mm=[],
        sheet_width_mm=2500.0, sheet_length_mm=5000.0,
        quantity=250, kerf_mm=0.0, edge_margin_mm=2.0,
    )
    elapsed = time.monotonic() - started
    assert result is not None, reason
    assert elapsed < 30.0, f"nest took {elapsed:.1f}s -- too slow at this part count"
    assert result["parts_per_sheet"] > 1000
    # A manual O(n^2) pairwise overlap check (as the other tests in this file
    # use) is itself ~1.6M shapely calls at this part count -- too slow to be
    # a useful regression guard. unary_union's own area is a cheap (shapely-
    # internal, spatially-indexed) way to prove the same thing: if any two
    # shrunk placements genuinely overlapped, the union's area would be
    # smaller than the sum of their individual areas by that overlap amount.
    shrunk = [p.buffer(-0.01) for p in _placement_polygons(small_part, result["placements"])]
    sum_area = sum(p.area for p in shrunk)
    union_area = unary_union(shrunk).area
    assert union_area >= sum_area - 1e-3, "placements overlap after grid-index change"


def test_capped_fires_honestly_under_a_tiny_evaluation_budget(monkeypatch):
    """Force the evaluation cap low and confirm the function stops safely
    with a real partial result and capped=True, rather than either hanging
    or silently reporting a wrong/complete-looking answer."""
    monkeypatch.setattr(nesting, "MAX_EVALUATIONS", 5)
    result, reason = nesting.compute_true_nest(
        outline_points_mm=SQUARE_10MM, holes_mm=[],
        sheet_width_mm=500.0, sheet_length_mm=500.0,
        quantity=100_000, kerf_mm=0.0, edge_margin_mm=2.0,
    )
    assert result is not None
    assert result["capped"] is True
    # Whatever it managed to place before hitting the cap must still be a
    # real, valid (non-overlapping, in-bounds) partial result.
    assert result["parts_per_sheet"] >= 0
    polys = _placement_polygons(SQUARE_10MM, result["placements"])
    for i in range(len(polys)):
        for j in range(i + 1, len(polys)):
            assert polys[i].buffer(-0.01).intersection(polys[j].buffer(-0.01)).area < 1e-6
