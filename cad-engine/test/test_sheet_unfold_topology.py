"""The flat pattern of a bent sheet: which panels each bend joins, read from the B-rep, on parts whose unfold is known."""
import math

import pytest

pytest.importorskip("OCC")

from OCC.Core.BRepBuilderAPI import BRepBuilderAPI_MakeEdge, BRepBuilderAPI_MakeWire  # noqa: E402
from OCC.Core.BRepGProp import brepgprop  # noqa: E402
from OCC.Core.BRepOffsetAPI import BRepOffsetAPI_MakeThickSolid  # noqa: E402
from OCC.Core.BRepPrimAPI import BRepPrimAPI_MakePrism  # noqa: E402
from OCC.Core.GC import GC_MakeArcOfCircle  # noqa: E402
from OCC.Core.GProp import GProp_GProps  # noqa: E402
from OCC.Core.gp import gp_Pnt, gp_Vec  # noqa: E402

from sheet_metal.feature_extractor import SheetMetalFeatureExtractor, _bend_panel_adjacency  # noqa: E402
from shared.memory_optimizer import AdvancedCADMemoryOptimizer  # noqa: E402


def _bent_sheet(points, radius, thickness, length):
    """A sheet folded along z: `points` is one side's profile in XY with every corner rounded to `radius`, extruded by
    `length` and thickened by `thickness` (OCC's own offset, so each bend is a true inner + outer cylinder pair)."""
    wire = BRepBuilderAPI_MakeWire()
    prev = gp_Pnt(*points[0], 0)
    for k in range(1, len(points) - 1):
        a, b, c = (complex(*p) for p in points[k - 1:k + 2])
        u1, u2 = (a - b) / abs(a - b), (c - b) / abs(c - b)
        half = math.acos(max(-1.0, min(1.0, (u1.conjugate() * u2).real))) / 2
        d = radius / math.tan(half)
        p1, p2 = b + u1 * d, b + u2 * d
        mid = b + (u1 + u2) / abs(u1 + u2) * (radius / math.sin(half) - radius)
        wire.Add(BRepBuilderAPI_MakeEdge(prev, gp_Pnt(p1.real, p1.imag, 0)).Edge())
        arc = GC_MakeArcOfCircle(gp_Pnt(p1.real, p1.imag, 0), gp_Pnt(mid.real, mid.imag, 0), gp_Pnt(p2.real, p2.imag, 0)).Value()
        wire.Add(BRepBuilderAPI_MakeEdge(arc).Edge())
        prev = gp_Pnt(p2.real, p2.imag, 0)
    wire.Add(BRepBuilderAPI_MakeEdge(prev, gp_Pnt(*points[-1], 0)).Edge())
    thick = BRepOffsetAPI_MakeThickSolid()
    thick.MakeThickSolidBySimple(BRepPrimAPI_MakePrism(wire.Wire(), gp_Vec(0, 0, length)).Shape(), thickness)
    thick.Build()
    solid = thick.Shape()
    props = GProp_GProps()
    brepgprop.VolumeProperties(solid, props)
    return solid.Reversed() if props.Mass() < 0 else solid


def _volume(shape):
    props = GProp_GProps()
    brepgprop.VolumeProperties(shape, props)
    return props.Mass()


def _features(shape):
    result = AdvancedCADMemoryOptimizer().analyze_and_optimize(shape, family_hint="sheet_metal", force_reanalysis=True)
    return result.geometry_features.manufacturing_features["manufacturing_intelligence"]["features"]


def _shoelace(points):
    return abs(sum(points[i][0] * points[(i + 1) % len(points)][1] - points[(i + 1) % len(points)][0] * points[i][1] for i in range(len(points)))) / 2


HAT = ([(0, 0), (30, 0), (30, 40), (90, 40), (90, 0), (120, 0)], 4.0, 2.0, 100.0)


def test_a_hat_profile_unfolds_to_one_outline_of_its_developed_area():
    # Two feet in one plane, four bends. Its pieces tile edge to edge; floating-point seams between a foot and its bend
    # strip used to leave them as separate polygons and the outline was declined as "fragmented".
    shape = _bent_sheet(*HAT)
    f = _features(shape)
    assert f["flat_pattern_outline_source"] == "wire_walk"
    assert _shoelace(f["flat_pattern_outline_points_mm"]) == pytest.approx(f["flat_pattern_area_mm2"], rel=0.005)
    assert f["flat_pattern_area_mm2"] == pytest.approx(_volume(shape) / 2.0, rel=0.02)  # developed area = volume / thickness


def test_each_panel_pairs_with_the_face_it_overlaps_not_a_coplanar_neighbour():
    # Each foot's top must pair with its own underside, not with the other foot's (same plane, one thickness apart).
    shape = _bent_sheet(*HAT)
    panels = SheetMetalFeatureExtractor()._identify_panels(shape, 2.0)
    assert len(panels) == 5
    feet = [p for p in panels if abs(p["normal"][1]) > 0.99 and abs(p["plane_d"]) < 5]
    assert len(feet) == 2 and all(abs(p["area"] - 2600) < 50 for p in feet)


def test_bends_join_their_panels_through_the_topology_on_a_thick_sheet():
    # 5 mm sheet, 2 mm inner radius: the outer face lies 7 mm from the bend axis, beyond the old 1.5R + 2 mm tolerance,
    # so the bend joined nothing and the outline was declined.
    shape = _bent_sheet([(0, 0), (80, 0), (80, 60)], 7.0, 5.0, 120.0)
    extractor = SheetMetalFeatureExtractor()
    panels = extractor._identify_panels(shape, 5.0)
    bends = extractor._collect_dedup_bends(shape, (0.0, 1.0, 0.0), 5.0)
    assert len(bends) == 1
    adjacency = _bend_panel_adjacency(panels, bends)
    assert sorted(len(a) for a in adjacency) == [1, 1]
    f = _features(shape)
    assert f["flat_pattern_outline_source"] == "wire_walk"
    assert _shoelace(f["flat_pattern_outline_points_mm"]) == pytest.approx(f["flat_pattern_area_mm2"], rel=0.005)


def test_a_bend_is_told_from_a_hole_by_the_panels_it_borders_not_by_the_main_panel_normal():
    # A bend whose axis runs along the part's main-panel normal (a wall folded from a wall) was taken for a hole and
    # dropped; told apart by its own neighbours, every bend is kept whatever the reference normal.
    shape = _bent_sheet([(0, 60), (0, 0), (100, 0), (100, 60)], 4.5, 3.0, 300.0)
    extractor = SheetMetalFeatureExtractor()
    for reference in ((0.0, 1.0, 0.0), (0.0, 0.0, 1.0)):
        assert len(extractor._collect_dedup_bends(shape, reference, 3.0)) == 2


def test_a_forced_family_keeps_what_the_geometry_alone_reads():
    # A solid block analysed as sheet metal because the user chose it: the geometry's own verdict is reported beside it.
    from OCC.Core.BRepPrimAPI import BRepPrimAPI_MakeBox

    result = AdvancedCADMemoryOptimizer().analyze_and_optimize(BRepPrimAPI_MakeBox(50.0, 40.0, 30.0).Shape(), family_hint="sheet_metal", force_reanalysis=True)
    mi = result.geometry_features.manufacturing_features["manufacturing_intelligence"]
    assert mi["detected_family"] == "sheet_metal"
    assert mi["geometric_family"] != "sheet_metal"
    assert any(r.startswith("geometry alone reads ") for r in mi["classification_reason"])


def test_a_multi_body_file_is_unfolded_blank_by_blank():
    # A bent bracket and a separate flat plate in one file (a weldment's two blanks): one sheet can't be both, so each
    # body is its own blank with its own outline, and the part's flat area is their sum.
    from OCC.Core.BRep import BRep_Builder
    from OCC.Core.BRepPrimAPI import BRepPrimAPI_MakeBox
    from OCC.Core.TopoDS import TopoDS_Compound
    from OCC.Core.gp import gp_Pnt as P

    bracket = _bent_sheet([(0, 0), (80, 0), (80, 60)], 4.0, 2.0, 100.0)
    plate = BRepPrimAPI_MakeBox(P(200, 0, 0), 120.0, 2.0, 90.0).Shape()  # 120 x 90 x 2, clear of the bracket
    compound = TopoDS_Compound()
    builder = BRep_Builder()
    builder.MakeCompound(compound)
    builder.Add(compound, bracket)
    builder.Add(compound, plate)

    f = _features(compound)
    blanks = f["flat_pattern_blanks"]
    assert len(blanks) == 2
    assert all(b["outline_source"] == "wire_walk" for b in blanks)
    areas = sorted(b["area_mm2"] for b in blanks)
    assert areas[0] == pytest.approx(120.0 * 90.0, rel=0.005)  # the plate
    assert areas[1] == pytest.approx(_volume(bracket) / 2.0, rel=0.02)  # the bracket's developed area
    assert f["flat_pattern_area_mm2"] == pytest.approx(sum(areas), abs=0.5)
    assert f["flat_pattern_outline_source"] == "unavailable"  # no one outline for two blanks; see flat_pattern_blanks


def test_an_ordinary_part_is_one_blank_equal_to_its_flat_pattern():
    f = _features(_bent_sheet(*HAT))
    (blank,) = f["flat_pattern_blanks"]
    assert blank["area_mm2"] == pytest.approx(f["flat_pattern_area_mm2"], abs=0.1)
    assert blank["outline_points_mm"] == f["flat_pattern_outline_points_mm"]
