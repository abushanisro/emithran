"""
Drawn-shell recognition on real B-Rep (sheet_metal/features/drawn_shell.py),
and its effect on the full production extract():

  - a round drawn cup (D80 x 50, t 1, 6 mm bottom radius): recognised, measured,
    and no longer misread as a rolled form + a through hole
  - a drawn rectangular box (120 x 80 x 30, t 1.2, 8 mm radii): recognised,
    and its corner/bottom radii no longer counted as press-brake bends
  - a press-brake U-channel and a flat plate: not drawn
"""
import pytest

pytest.importorskip("OCC")

from OCC.Core.BRepPrimAPI import BRepPrimAPI_MakeCylinder, BRepPrimAPI_MakeBox  # noqa: E402
from OCC.Core.BRepFilletAPI import BRepFilletAPI_MakeFillet  # noqa: E402
from OCC.Core.BRepOffsetAPI import BRepOffsetAPI_MakeThickSolid  # noqa: E402
from OCC.Core.TopTools import TopTools_ListOfShape  # noqa: E402
from OCC.Core.TopExp import TopExp_Explorer  # noqa: E402
from OCC.Core.TopAbs import TopAbs_EDGE, TopAbs_FACE  # noqa: E402
from OCC.Core.TopoDS import topods  # noqa: E402
from OCC.Core.BRepAdaptor import BRepAdaptor_Surface, BRepAdaptor_Curve  # noqa: E402
from OCC.Core.GeomAbs import GeomAbs_Plane  # noqa: E402
from OCC.Core.gp import gp_Ax2, gp_Pnt, gp_Dir  # noqa: E402

from sheet_metal.features.drawn_shell import detect_drawn_shell  # noqa: E402
from sheet_metal.feature_extractor import SheetMetalFeatureExtractor  # noqa: E402
from test_sheet_metal_feature_graph import _scan_cylinders_and_bbox  # noqa: E402
from test_bend_relationships import make_bent_sheet  # noqa: E402

UP = (0.0, 0.0, 1.0)


def _drawn(solid, radius, t, top_z):
    """Fillet the bottom edges, then hollow the solid inward (open top) to a
    constant-thickness shell -- the geometry a drawing operation leaves."""
    mk = BRepFilletAPI_MakeFillet(solid)
    exp = TopExp_Explorer(solid, TopAbs_EDGE)
    while exp.More():
        e = topods.Edge(exp.Current())
        c = BRepAdaptor_Curve(e)
        # Every edge touching the bottom: the bottom edges and, on a box, the
        # vertical corners -- the radii a drawing punch leaves.
        if abs(c.Value(c.FirstParameter()).Z()) < 1e-6 or abs(c.Value(c.LastParameter()).Z()) < 1e-6:
            mk.Add(radius, e)
        exp.Next()
    s = mk.Shape()
    open_faces = TopTools_ListOfShape()
    exp = TopExp_Explorer(s, TopAbs_FACE)
    while exp.More():
        f = topods.Face(exp.Current())
        a = BRepAdaptor_Surface(f)
        if a.GetType() == GeomAbs_Plane and abs(a.Plane().Location().Z() - top_z) < 1e-6:
            open_faces.Append(f)
        exp.Next()
    th = BRepOffsetAPI_MakeThickSolid()
    th.MakeThickSolidByJoin(s, open_faces, -t, 1e-3)
    return th.Shape()


def _cup():
    return _drawn(BRepPrimAPI_MakeCylinder(gp_Ax2(gp_Pnt(0, 0, 0), gp_Dir(0, 0, 1)), 40, 50).Shape(), 6, 1.0, 50)


def _box():
    return _drawn(BRepPrimAPI_MakeBox(120, 80, 30).Shape(), 8, 1.2, 30)


def _extract(shape):
    raw, bb = _scan_cylinders_and_bbox(shape)
    return SheetMetalFeatureExtractor().extract(
        shape,
        bbox_dims=[bb["xmax"] - bb["xmin"], bb["ymax"] - bb["ymin"], bb["zmax"] - bb["zmin"]],
        raw_cylinders_full=raw,
        bbox_minmax=bb,
    )


def _kinds(result):
    return {(f["feature_type"], f["variant"]) for f in result["feature_graph_v2"]["features"]}


def test_round_cup_is_recognised_and_measured():
    shell = detect_drawn_shell(_cup(), 1.0, UP)
    assert shell is not None and shell["recognition_status"] == "recognized"
    assert shell["depth_mm"] == pytest.approx(50.0, abs=0.1)
    assert shell["opening_width_mm"] == pytest.approx(80.0, rel=0.002)
    assert shell["depth_to_width"] == pytest.approx(50.0 / 80.0, rel=0.003)
    assert shell["developed_area_mm2"] > 0


def test_drawn_box_is_recognised_and_measured():
    shell = detect_drawn_shell(_box(), 1.2, UP)
    assert shell is not None
    assert shell["depth_mm"] == pytest.approx(30.0, abs=0.1)
    assert shell["opening_width_mm"] == pytest.approx(80.0, abs=0.1)


def test_press_brake_channel_and_flat_plate_are_not_drawn():
    channel = make_bent_sheet(seg_lens=[30.0, 20.0, 30.0], angles_deg=[90.0, 90.0])
    assert detect_drawn_shell(channel, 2.0, UP) is None
    assert detect_drawn_shell(BRepPrimAPI_MakeBox(100, 60, 2).Shape(), 2.0, UP) is None


def test_extract_reports_the_cup_as_drawn_not_rolled_or_holed():
    result = _extract(_cup())
    kinds = _kinds(result)
    assert ("Form", "drawn") in kinds
    assert ("Form", "rolled") not in kinds
    assert ("SimpleHole", "through") not in kinds
    assert result["rolled_form_count"] == 0
    assert result["drawn_shell"]["opening_width_mm"] == pytest.approx(80.0, rel=0.002)


def test_extract_does_not_count_a_drawn_box_radii_as_bends():
    result = _extract(_box())
    assert ("Form", "drawn") in _kinds(result)
    assert ("StraightBend", "default") not in _kinds(result)
    assert result["bend_count"] == 0


def test_press_brake_part_is_unchanged():
    result = _extract(make_bent_sheet(seg_lens=[30.0, 20.0, 30.0], angles_deg=[90.0, 90.0]))
    assert result["drawn_shell"] is None
    assert result["bend_count"] >= 2
