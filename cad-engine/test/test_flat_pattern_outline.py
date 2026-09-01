"""
Tests for SheetMetalFeatureExtractor._compute_flat_pattern_outline -- the
real flat-pattern outline + hole extraction added for true (non-rectangle)
nesting visualization.

No test infrastructure existed anywhere in cad-engine before this file.
Requires pythonocc-core (see cad-engine/Dockerfile's conda environment) and
shapely (cad-engine/requirements.txt) to be importable -- run inside that
same environment, e.g.:
    conda run -n <env-with-pythonocc-core> pytest test_flat_pattern_outline.py -v

Fixtures are built from OCC primitives directly (no STEP file needed) --
this exercises the real wire-walk/tessellation/shapely-union code path
end-to-end, just against synthetic (not imported) geometry.
"""
import math

import pytest

pytest.importorskip("OCC")
pytest.importorskip("shapely")

from OCC.Core.BRepPrimAPI import BRepPrimAPI_MakeBox, BRepPrimAPI_MakeCylinder, BRepPrimAPI_MakePrism  # type: ignore
from shapely.geometry import Polygon as ShapelyPolygon  # type: ignore
from OCC.Core.BRepBuilderAPI import BRepBuilderAPI_MakePolygon, BRepBuilderAPI_MakeFace  # type: ignore
from OCC.Core.BRepAlgoAPI import BRepAlgoAPI_Cut  # type: ignore
from OCC.Core.BRepGProp import brepgprop  # type: ignore
from OCC.Core.GProp import GProp_GProps  # type: ignore
from OCC.Core.gp import gp_Pnt, gp_Ax2, gp_Dir, gp_Vec  # type: ignore
from OCC.Core.TopExp import TopExp_Explorer  # type: ignore
from OCC.Core.TopAbs import TopAbs_FACE  # type: ignore
from OCC.Core.TopoDS import topods  # type: ignore
from OCC.Core.BRepAdaptor import BRepAdaptor_Surface  # type: ignore
from OCC.Core.GeomAbs import GeomAbs_Plane  # type: ignore

from sheet_metal.feature_extractor import SheetMetalFeatureExtractor


def _find_top_face(shape, min_area=100.0):
    """Largest planar face whose normal is ~+Z -- mirrors how the real
    pipeline's dominant_face selection works elsewhere in feature_extractors.py."""
    best_face, best_area = None, 0.0
    exp = TopExp_Explorer(shape, TopAbs_FACE)
    while exp.More():
        face = topods.Face(exp.Current())
        adaptor = BRepAdaptor_Surface(face)
        if adaptor.GetType() == GeomAbs_Plane:
            n = adaptor.Plane().Axis().Direction()
            if abs(n.Z()) > 0.99:
                props = GProp_GProps()
                brepgprop.SurfaceProperties(face, props)
                if props.Mass() > best_area and props.Mass() > min_area:
                    best_area = props.Mass()
                    best_face = face
        exp.Next()
    return best_face


def _shoelace_area(points_xy):
    n = len(points_xy)
    s = 0.0
    for i in range(n):
        x1, y1 = points_xy[i]
        x2, y2 = points_xy[(i + 1) % n]
        s += x1 * y2 - x2 * y1
    return abs(s) / 2.0


@pytest.fixture
def extractor():
    return SheetMetalFeatureExtractor()


def test_flat_plate_with_hole_outline_and_hole_position(extractor):
    """A flat 100x60x2mm plate with a 10mm-diameter hole at (50,30): the
    outline must be the plate's true rectangle (not the hole's inner
    boundary, which OuterWire correctly excludes), and the hole must be
    reported separately at its real position/diameter."""
    box = BRepPrimAPI_MakeBox(100.0, 60.0, 2.0).Shape()
    cyl_axis = gp_Ax2(gp_Pnt(50.0, 30.0, -1.0), gp_Dir(0, 0, 1))
    hole_solid = BRepPrimAPI_MakeCylinder(cyl_axis, 5.0, 4.0).Shape()
    shape = BRepAlgoAPI_Cut(box, hole_solid).Shape()

    dominant_face = _find_top_face(shape)
    assert dominant_face is not None

    panels = extractor._identify_panels(shape, 2.0)
    assert len(panels) == 1

    hole_centroids_mm = [(50.0, 30.0, 1.0, 10.0)]
    result = extractor._compute_flat_pattern_outline(dominant_face, panels, [], hole_centroids_mm)
    assert result is not None

    pts = result["outline_points_mm"]
    xs = [p[0] for p in pts]
    ys = [p[1] for p in pts]
    assert min(xs) == pytest.approx(0.0, abs=0.05)
    assert max(xs) == pytest.approx(100.0, abs=0.05)
    assert min(ys) == pytest.approx(0.0, abs=0.05)
    assert max(ys) == pytest.approx(60.0, abs=0.05)

    # Outline is a valid simple (non-self-intersecting) closed polygon whose
    # area matches the plate's real area, not a degenerate shape -- this is
    # the exact regression this test guards: an earlier version of the
    # wire-walk ignored edge orientation and produced a degenerate 3-point
    # triangle covering half the plate instead of its real 4 corners.
    ring = pts[:-1] if pts[0] == pts[-1] else pts
    area = _shoelace_area([(p[0], p[1]) for p in ring])
    assert area == pytest.approx(100.0 * 60.0, rel=0.01)

    assert len(result["holes_mm"]) == 1
    h = result["holes_mm"][0]
    assert h["cx_mm"] == pytest.approx(50.0, abs=0.1)
    assert h["cy_mm"] == pytest.approx(30.0, abs=0.1)
    assert h["diameter_mm"] == pytest.approx(10.0, abs=0.1)


def test_trapezoid_outline_matches_real_shape_not_bounding_rect(extractor):
    """A trapezoid panel (the reference nesting drawing's actual part
    shape) -- the extracted outline's own area must match the true
    trapezoid area, not its (larger) bounding-rectangle area. This is what
    distinguishes real outline extraction from the pre-existing
    bounding-rect-only nesting engine."""
    input_pts = [(0.0, 0.0), (165.35, 0.0), (132.68, 62.93), (32.68, 62.93)]
    poly_builder = BRepBuilderAPI_MakePolygon()
    for x, y in input_pts:
        poly_builder.Add(gp_Pnt(x, y, 0.0))
    poly_builder.Close()
    face = BRepBuilderAPI_MakeFace(poly_builder.Wire()).Face()
    shape = BRepPrimAPI_MakePrism(face, gp_Vec(0, 0, 1.6)).Shape()

    dominant_face = _find_top_face(shape)
    assert dominant_face is not None
    panels = extractor._identify_panels(shape, 1.6)
    assert len(panels) == 1

    result = extractor._compute_flat_pattern_outline(dominant_face, panels, [], [])
    assert result is not None

    pts = result["outline_points_mm"]
    ring = pts[:-1] if pts[0] == pts[-1] else pts
    got_area = _shoelace_area([(p[0], p[1]) for p in ring])
    expected_area = _shoelace_area(input_pts)
    bounding_rect_area = 165.35 * 62.93

    assert got_area == pytest.approx(expected_area, rel=0.01)
    # The real point of this test: outline area is meaningfully SMALLER than
    # the bounding-rect area for a non-rectangular part -- proving this is
    # the true silhouette, not a rectangle placeholder.
    assert got_area < bounding_rect_area * 0.95


def test_concave_l_bracket_outline_distinguishes_boundary_from_hole(extractor):
    """A concave L-bracket flat pattern (100x100mm square with a 50x50mm
    notch cut from one corner) with a hole in the remaining leg -- confirms
    the extractor (a) represents a genuinely concave outer boundary (not
    silently simplified to a rectangle or convex hull), and (b) correctly
    keeps a hole separate from that boundary rather than merging it into
    the outline ring or corrupting it."""
    outline_pts = [(0, 0), (100, 0), (100, 50), (50, 50), (50, 100), (0, 100)]
    poly_builder = BRepBuilderAPI_MakePolygon()
    for x, y in outline_pts:
        poly_builder.Add(gp_Pnt(x, y, 0.0))
    poly_builder.Close()
    face = BRepBuilderAPI_MakeFace(poly_builder.Wire()).Face()
    solid = BRepPrimAPI_MakePrism(face, gp_Vec(0, 0, 2.0)).Shape()
    cyl_axis = gp_Ax2(gp_Pnt(25.0, 25.0, -1.0), gp_Dir(0, 0, 1))
    hole_solid = BRepPrimAPI_MakeCylinder(cyl_axis, 3.0, 4.0).Shape()
    shape = BRepAlgoAPI_Cut(solid, hole_solid).Shape()

    dominant_face = _find_top_face(shape)
    assert dominant_face is not None
    panels = extractor._identify_panels(shape, 2.0)
    assert len(panels) == 1

    hole_centroids_mm = [(25.0, 25.0, 1.0, 6.0)]
    result = extractor._compute_flat_pattern_outline(dominant_face, panels, [], hole_centroids_mm)
    assert result is not None

    pts = result["outline_points_mm"]
    ring = pts[:-1] if pts[0] == pts[-1] else pts
    shp = ShapelyPolygon([(p[0], p[1]) for p in ring])
    assert shp.is_valid

    expected_outline_area = 100 * 100 - 50 * 50  # OuterWire excludes the hole; the notch is part of the boundary itself
    assert shp.area == pytest.approx(expected_outline_area, abs=5.0)
    # Genuinely concave: convex hull area must exceed the real outline area.
    assert shp.convex_hull.area > shp.area * 1.01

    assert len(result["holes_mm"]) == 1
    h = result["holes_mm"][0]
    assert h["cx_mm"] == pytest.approx(25.0, abs=0.1)
    assert h["cy_mm"] == pytest.approx(25.0, abs=0.1)
    assert h["diameter_mm"] == pytest.approx(6.0, abs=0.5)


def test_area_reconciliation_accepts_agreeing_area(extractor):
    """The trapezoid's own real area, passed as expected_area_mm2, must be
    accepted (proves the reconciliation check doesn't reject legitimate,
    correctly-extracted outlines)."""
    input_pts = [(0.0, 0.0), (165.35, 0.0), (132.68, 62.93), (32.68, 62.93)]
    poly_builder = BRepBuilderAPI_MakePolygon()
    for x, y in input_pts:
        poly_builder.Add(gp_Pnt(x, y, 0.0))
    poly_builder.Close()
    face = BRepBuilderAPI_MakeFace(poly_builder.Wire()).Face()
    shape = BRepPrimAPI_MakePrism(face, gp_Vec(0, 0, 1.6)).Shape()

    dominant_face = _find_top_face(shape)
    panels = extractor._identify_panels(shape, 1.6)
    real_area = ShapelyPolygon(input_pts).area

    result = extractor._compute_flat_pattern_outline(dominant_face, panels, [], [], expected_area_mm2=real_area)
    assert result is not None


def test_area_reconciliation_rejects_disagreeing_area(extractor):
    """A deliberately wrong expected_area_mm2 (2x the real area) must cause
    the function to decline rather than hand back an outline that
    contradicts the part's own independently-known area -- this is the
    actual behavior the reconciliation check exists to enforce."""
    input_pts = [(0.0, 0.0), (165.35, 0.0), (132.68, 62.93), (32.68, 62.93)]
    poly_builder = BRepBuilderAPI_MakePolygon()
    for x, y in input_pts:
        poly_builder.Add(gp_Pnt(x, y, 0.0))
    poly_builder.Close()
    face = BRepBuilderAPI_MakeFace(poly_builder.Wire()).Face()
    shape = BRepPrimAPI_MakePrism(face, gp_Vec(0, 0, 1.6)).Shape()

    dominant_face = _find_top_face(shape)
    panels = extractor._identify_panels(shape, 1.6)
    real_area = ShapelyPolygon(input_pts).area

    result = extractor._compute_flat_pattern_outline(dominant_face, panels, [], [], expected_area_mm2=real_area * 2.0)
    assert result is None


def test_area_reconciliation_corrects_for_hole_area_not_gross_outline_area(extractor):
    """expected_area_mm2 (from _compute_true_flat_pattern_area) is the NET
    area with holes already subtracted; the outline polygon's own area is
    GROSS (OuterWire excludes hole boundaries entirely, so holes are still
    "filled in"). Passing the real NET area (gross rectangle minus the
    hole) must be accepted -- if the reconciliation compared against gross
    outline area instead, this would wrongly fail for any part with a
    non-trivial hole."""
    box = BRepPrimAPI_MakeBox(100.0, 60.0, 2.0).Shape()
    cyl_axis = gp_Ax2(gp_Pnt(50.0, 30.0, -1.0), gp_Dir(0, 0, 1))
    hole_solid = BRepPrimAPI_MakeCylinder(cyl_axis, 5.0, 4.0).Shape()
    shape = BRepAlgoAPI_Cut(box, hole_solid).Shape()

    dominant_face = _find_top_face(shape)
    panels = extractor._identify_panels(shape, 2.0)
    hole_centroids_mm = [(50.0, 30.0, 1.0, 10.0)]

    gross_area = 100.0 * 60.0
    hole_area = 3.14159265 * 5.0 ** 2
    net_area = gross_area - hole_area  # what _compute_true_flat_pattern_area would report

    result = extractor._compute_flat_pattern_outline(dominant_face, panels, [], hole_centroids_mm, expected_area_mm2=net_area)
    assert result is not None, "reconciliation wrongly rejected a correctly hole-corrected net area"

    # Sanity: passing the GROSS area instead (no hole correction) as if it
    # were net must NOT be treated as an error on this function's part --
    # it genuinely disagrees with the real net area by the hole's share,
    # which for this ~10mm hole on a 6000mm² plate is small (~1.3%, under
    # the 10% tolerance) -- use a part with a much larger hole to actually
    # prove gross-vs-net matters.


def test_area_reconciliation_hole_correction_matters_for_large_holes(extractor):
    """Same as above but with a hole large enough that gross-vs-net
    actually crosses the 10% tolerance -- proves the hole correction is
    load-bearing, not just harmless."""
    box = BRepPrimAPI_MakeBox(100.0, 60.0, 2.0).Shape()
    cyl_axis = gp_Ax2(gp_Pnt(50.0, 30.0, -1.0), gp_Dir(0, 0, 1))
    hole_solid = BRepPrimAPI_MakeCylinder(cyl_axis, 25.0, 4.0).Shape()  # 50mm diameter -- large relative to the 100x60 plate
    shape = BRepAlgoAPI_Cut(box, hole_solid).Shape()

    dominant_face = _find_top_face(shape)
    panels = extractor._identify_panels(shape, 2.0)
    hole_centroids_mm = [(50.0, 30.0, 1.0, 50.0)]

    gross_area = 100.0 * 60.0
    hole_area = 3.14159265 * 25.0 ** 2
    net_area = gross_area - hole_area
    assert abs(gross_area - net_area) / net_area > 0.10, "test hole not large enough to exceed tolerance -- fixture needs adjusting"

    # Passing the real NET area must be accepted.
    result_net = extractor._compute_flat_pattern_outline(dominant_face, panels, [], hole_centroids_mm, expected_area_mm2=net_area)
    assert result_net is not None

    # Passing the GROSS area (as if holes weren't subtracted) must be
    # rejected -- proves the function is actually comparing against the
    # hole-corrected net figure, not silently accepting anything close to
    # the raw outline polygon area.
    result_gross = extractor._compute_flat_pattern_outline(dominant_face, panels, [], hole_centroids_mm, expected_area_mm2=gross_area)
    assert result_gross is None


def test_multipanel_bend_bridges_connect_into_one_outline(extractor):
    """Regression for a real bug found live on production data (a 3-bend
    part): two flat panels connected by a bend are NOT adjacent in 3D -- a
    curved bend face (a separate face from either panel) sits between them.
    Without explicitly including that bend's own flattened strip in the
    union, each panel's wire-walk boundary stops exactly where it meets the
    bend face, never touching the other panel in the common 2D frame -- the
    real production part's 3 panels fragmented into disconnected islands
    (largest piece only ~36% of total area) and were correctly declined as
    untrusted, exposing this gap. Panels/bends are supplied directly here
    (not auto-detected from a fused solid) since constructing a physically
    valid filleted sheet-metal solid from raw primitives is unnecessary --
    this function only ever consumes these two lists, never solid topology."""
    def make_face(pts):
        b = BRepBuilderAPI_MakePolygon()
        for x, y, z in pts:
            b.Add(gp_Pnt(x, y, z))
        b.Close()
        return BRepBuilderAPI_MakeFace(b.Wire()).Face()

    # Panel A: base, z=0 plane, x=[0,50] y=[0,30]
    face_a = make_face([(0, 0, 0), (50, 0, 0), (50, 30, 0), (0, 30, 0)])
    # Panel B: wall, y=30 plane, x=[0,50] z=[0,40] -- folded up from panel A's far edge
    face_b = make_face([(0, 30, 0), (50, 30, 0), (50, 30, 40), (0, 30, 40)])

    panels = [
        {"normal": (0.0, 0.0, 1.0), "plane_d": 0.0, "face": face_a, "area": 50.0 * 30.0},
        {"normal": (0.0, 1.0, 0.0), "plane_d": 30.0, "face": face_b, "area": 50.0 * 40.0},
    ]
    # axis_point deliberately NOT centered on the real bend extent (a real
    # regression case: axis_point is only documented as "closest point to
    # the origin on the axis line", not the bend's center) -- proves the
    # bridge construction doesn't depend on that assumption.
    bends = [
        {"dir": (1.0, 0.0, 0.0), "axis_point": (0.0, 30.0, 0.0), "radius": 5.0,
         "angle_rad": math.pi / 2, "axial_length": 50.0, "allowance_mm": 8.0},
    ]

    expected_area = 50.0 * 30.0 + 50.0 * 40.0 + 50.0 * 8.0  # 2 panels + the bend's own flattened strip
    result = extractor._compute_flat_pattern_outline(face_a, panels, bends, [], expected_area_mm2=expected_area)
    assert result is not None, "panels fragmented instead of connecting through the bend bridge"

    pts = result["outline_points_mm"]
    ring = pts[:-1] if pts[0] == pts[-1] else pts
    shp = ShapelyPolygon([(p[0], p[1]) for p in ring])
    assert shp.is_valid
    assert shp.area == pytest.approx(expected_area, abs=5.0)

    xs = [p[0] for p in pts]
    ys = [p[1] for p in pts]
    # Width along the fold direction must match panel A's real 50mm span,
    # not be skewed by an incorrectly-centered bridge (the actual bug found).
    assert (max(xs) - min(xs)) == pytest.approx(50.0, abs=1.0)
    # Length: panel A's 30mm + the bend's 8mm allowance + panel B's 40mm.
    assert (max(ys) - min(ys)) == pytest.approx(30.0 + 8.0 + 40.0, abs=1.0)


def test_returns_none_without_panels(extractor):
    assert extractor._compute_flat_pattern_outline(None, None, [], []) is None
    assert extractor._compute_flat_pattern_outline(None, [], [], []) is None


def test_hole_not_matching_any_panel_plane_is_skipped(extractor):
    """A hole centroid nowhere near any real panel's plane must be
    dropped, not guessed onto the nearest panel regardless of distance."""
    box = BRepPrimAPI_MakeBox(100.0, 60.0, 2.0).Shape()
    dominant_face = _find_top_face(box)
    panels = extractor._identify_panels(box, 2.0)
    assert len(panels) == 1

    far_away_centroid = [(50.0, 30.0, 500.0, 10.0)]  # 500mm off the panel's plane
    result = extractor._compute_flat_pattern_outline(dominant_face, panels, [], far_away_centroid)
    assert result is not None
    assert result["holes_mm"] == []
