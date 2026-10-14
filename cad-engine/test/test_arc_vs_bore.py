"""
A bore wraps its axis; an arc of a cylinder is something else.

Before: every internal cylinder face became a blind hole, so the R3 corners of a rounded pocket,
the ends of a slot and inside fillets were reported as Ø6 holes. A bore is now a cylinder whose
merged patches sweep (nearly) a full turn; a partial arc keeps its real radius as an Edge/round
with the sweep and orientation that justify it. Real OCC solids, analytic and B-spline.
"""
import math

import pytest
from OCC.Core.BRepAlgoAPI import BRepAlgoAPI_Cut
from OCC.Core.BRepBuilderAPI import BRepBuilderAPI_NurbsConvert
from OCC.Core.BRepFilletAPI import BRepFilletAPI_MakeFillet
from OCC.Core.BRepPrimAPI import BRepPrimAPI_MakeBox, BRepPrimAPI_MakeCylinder
from OCC.Core.gp import gp_Ax2, gp_Dir, gp_Pnt, gp_Trsf
from OCC.Core.BRepBuilderAPI import BRepBuilderAPI_Transform
from OCC.Core.TopAbs import TopAbs_EDGE
from OCC.Core.TopExp import TopExp_Explorer
from OCC.Core.TopoDS import topods

from machining.machining_feature_recognizer import MachiningFeatureRecognizer


def _vertical_edges(shape):
    """Edges parallel to Z."""
    from OCC.Core.BRepAdaptor import BRepAdaptor_Curve
    out = []
    exp = TopExp_Explorer(shape, TopAbs_EDGE)
    while exp.More():
        e = topods.Edge(exp.Current())
        c = BRepAdaptor_Curve(e)
        a, b = c.Value(c.FirstParameter()), c.Value(c.LastParameter())
        if abs(a.X() - b.X()) < 1e-6 and abs(a.Y() - b.Y()) < 1e-6 and abs(a.Z() - b.Z()) > 1e-6:
            out.append(e)
        exp.Next()
    return out


def _plate_with_round_cornered_pocket():
    """60 x 40 x 20 block, one Ø10 through hole, and a 20 x 14 pocket 5 deep with R3 corners."""
    body = BRepPrimAPI_MakeBox(60.0, 40.0, 20.0).Shape()
    through = BRepPrimAPI_MakeCylinder(gp_Ax2(gp_Pnt(15, 20, -1), gp_Dir(0, 0, 1)), 5.0, 22.0).Shape()
    body = BRepAlgoAPI_Cut(body, through).Shape()
    tool = BRepPrimAPI_MakeBox(gp_Pnt(35, 13, 15), 20.0, 14.0, 6.0).Shape()
    fillet = BRepFilletAPI_MakeFillet(tool)
    for e in _vertical_edges(tool):
        fillet.Add(3.0, e)
    return BRepAlgoAPI_Cut(body, fillet.Shape()).Shape()


def _block_with_outside_fillet():
    body = BRepPrimAPI_MakeBox(40.0, 30.0, 10.0).Shape()
    fillet = BRepFilletAPI_MakeFillet(body)
    fillet.Add(2.0, _vertical_edges(body)[0])
    return fillet.Shape()


def _nurbs(shape):
    return BRepBuilderAPI_NurbsConvert(shape, True).Shape()


def _features(shape):
    return MachiningFeatureRecognizer().recognize(shape, "milled").features


def _hole_diameters(shape):
    return sorted(f.params["diameter_mm"] for f in _features(shape) if f.type == "SimpleHole")


def _rounds(shape):
    return [f for f in _features(shape) if f.type == "Edge" and f.variant == "round"
            and "sweep_deg" in f.params]


@pytest.mark.parametrize("convert", [False, True], ids=["analytic", "bspline"])
def test_rounded_pocket_corners_are_rounds_not_holes(convert):
    shape = _plate_with_round_cornered_pocket()
    shape = _nurbs(shape) if convert else shape
    assert _hole_diameters(shape) == [10.0]
    rounds = _rounds(shape)
    assert sorted(round(f.params["radius_mm"], 2) for f in rounds) == [3.0] * 4
    for f in rounds:
        assert f.params["sweep_deg"] == pytest.approx(90.0, abs=1.5)
        assert f.params["concave"] is True
        assert f.face_ids


@pytest.mark.parametrize("convert", [False, True], ids=["analytic", "bspline"])
def test_an_outside_fillet_is_a_convex_round_not_a_hole(convert):
    shape = _block_with_outside_fillet()
    shape = _nurbs(shape) if convert else shape
    assert _hole_diameters(shape) == []
    rounds = _rounds(shape)
    assert [round(f.params["radius_mm"], 2) for f in rounds] == [2.0]
    assert rounds[0].params["concave"] is False


@pytest.mark.parametrize("convert", [False, True], ids=["analytic", "bspline"])
def test_a_full_bore_stays_one_hole_with_full_sweep(convert):
    body = BRepAlgoAPI_Cut(
        BRepPrimAPI_MakeBox(40.0, 40.0, 20.0).Shape(),
        BRepPrimAPI_MakeCylinder(gp_Ax2(gp_Pnt(20, 20, -1), gp_Dir(0, 0, 1)), 7.0, 22.0).Shape(),
    ).Shape()
    body = _nurbs(body) if convert else body
    assert _hole_diameters(body) == [14.0]
    assert _rounds(body) == []
