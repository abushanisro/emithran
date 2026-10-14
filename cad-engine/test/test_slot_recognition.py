"""
An obround slot is two opposite half-turn arcs joined by straight walls.

Before: each end read as a separate "round" (or, before that, as a hole). Two concave ~180 degree arcs
of equal radius on parallel axes that cut the same depth are now one Slot/straight with the width,
length and centre distance the arcs state. Real OCC solids, analytic and B-spline.
"""
import math

import pytest
from OCC.Core.BRepAlgoAPI import BRepAlgoAPI_Cut, BRepAlgoAPI_Fuse
from OCC.Core.BRepBuilderAPI import BRepBuilderAPI_NurbsConvert
from OCC.Core.BRepFilletAPI import BRepFilletAPI_MakeFillet
from OCC.Core.BRepPrimAPI import BRepPrimAPI_MakeBox, BRepPrimAPI_MakeCylinder
from OCC.Core.BRepAdaptor import BRepAdaptor_Curve
from OCC.Core.gp import gp_Ax2, gp_Dir, gp_Pnt
from OCC.Core.TopAbs import TopAbs_EDGE
from OCC.Core.TopExp import TopExp_Explorer
from OCC.Core.TopoDS import topods

from machining.machining_feature_recognizer import MachiningFeatureRecognizer


def _obround_tool(cx, cy, z0, length_between_centres, radius, height):
    """A stadium prism: two cylinders of `radius` joined by a box of width 2*radius."""
    box = BRepPrimAPI_MakeBox(gp_Pnt(cx - length_between_centres / 2, cy - radius, z0), length_between_centres, 2 * radius, height).Shape()
    left = BRepPrimAPI_MakeCylinder(gp_Ax2(gp_Pnt(cx - length_between_centres / 2, cy, z0), gp_Dir(0, 0, 1)), radius, height).Shape()
    right = BRepPrimAPI_MakeCylinder(gp_Ax2(gp_Pnt(cx + length_between_centres / 2, cy, z0), gp_Dir(0, 0, 1)), radius, height).Shape()
    return BRepAlgoAPI_Fuse(BRepAlgoAPI_Fuse(box, left).Shape(), right).Shape()


def _plate_with_slot(through=True):
    """80 x 50 x 10 plate; a 15 wide slot, 14 between its end centres (29 long overall)."""
    body = BRepPrimAPI_MakeBox(80.0, 50.0, 10.0).Shape()
    tool = _obround_tool(40, 25, -1 if through else 4, 14.0, 7.5, 12.0 if through else 7.0)
    return BRepAlgoAPI_Cut(body, tool).Shape()


def _vertical_edges(shape):
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


def _nurbs(shape):
    return BRepBuilderAPI_NurbsConvert(shape, True).Shape()


def _features(shape):
    return MachiningFeatureRecognizer().recognize(shape, "milled").features


def _slots(shape):
    return [f for f in _features(shape) if f.type == "Slot" and f.variant == "straight"]


@pytest.mark.parametrize("convert", [False, True], ids=["analytic", "bspline"])
def test_an_obround_slot_is_one_slot_with_its_real_size(convert):
    shape = _plate_with_slot()
    shape = _nurbs(shape) if convert else shape
    slots = _slots(shape)
    assert len(slots) == 1
    p = slots[0].params
    assert p["width_mm"] == pytest.approx(15.0, abs=0.01)
    assert p["end_radius_mm"] == pytest.approx(7.5, abs=0.01)
    assert p["centre_distance_mm"] == pytest.approx(14.0, abs=0.01)
    assert p["length_mm"] == pytest.approx(29.0, abs=0.01)
    assert p["depth_mm"] == pytest.approx(10.0, abs=0.05)
    assert p["area_mm2"] == pytest.approx(2 * 7.5 * 14.0 + math.pi * 7.5 ** 2, abs=0.05)
    assert p["centroid"][0] == pytest.approx(40.0, abs=0.1) and p["centroid"][1] == pytest.approx(25.0, abs=0.1)
    assert slots[0].face_ids


@pytest.mark.parametrize("convert", [False, True], ids=["analytic", "bspline"])
def test_the_slot_ends_are_not_also_reported_as_rounds_or_holes(convert):
    shape = _plate_with_slot()
    shape = _nurbs(shape) if convert else shape
    feats = _features(shape)
    assert not [f for f in feats if f.type == "SimpleHole"]
    assert not [f for f in feats if f.type == "Edge" and f.variant == "round" and "sweep_deg" in f.params]


def test_a_blind_slot_reports_its_own_depth():
    slots = _slots(_plate_with_slot(through=False))
    assert len(slots) == 1
    assert slots[0].params["depth_mm"] == pytest.approx(7.0 - 1.0 + 0.0, abs=0.6)  # tool 4..11 clipped by the 10 mm plate: 6 deep


def test_quarter_round_pocket_corners_are_never_a_slot():
    body = BRepPrimAPI_MakeBox(60.0, 40.0, 20.0).Shape()
    tool = BRepPrimAPI_MakeBox(gp_Pnt(20, 10, 15), 20.0, 14.0, 6.0).Shape()
    fillet = BRepFilletAPI_MakeFillet(tool)
    for e in _vertical_edges(tool):
        fillet.Add(3.0, e)
    shape = BRepAlgoAPI_Cut(body, fillet.Shape()).Shape()
    assert _slots(shape) == []


def test_a_lone_half_turn_arc_is_a_round_not_a_slot():
    """One semicircular notch has no opposite end."""
    body = BRepPrimAPI_MakeBox(60.0, 40.0, 10.0).Shape()
    notch = BRepPrimAPI_MakeCylinder(gp_Ax2(gp_Pnt(30, 0, -1), gp_Dir(0, 0, 1)), 6.0, 12.0).Shape()
    shape = BRepAlgoAPI_Cut(body, notch).Shape()
    assert _slots(shape) == []


def test_two_unrelated_half_turns_of_different_radius_do_not_pair():
    body = BRepPrimAPI_MakeBox(100.0, 40.0, 10.0).Shape()
    n1 = BRepPrimAPI_MakeCylinder(gp_Ax2(gp_Pnt(20, 0, -1), gp_Dir(0, 0, 1)), 6.0, 12.0).Shape()
    n2 = BRepPrimAPI_MakeCylinder(gp_Ax2(gp_Pnt(70, 0, -1), gp_Dir(0, 0, 1)), 9.0, 12.0).Shape()
    shape = BRepAlgoAPI_Cut(BRepAlgoAPI_Cut(body, n1).Shape(), n2).Shape()
    assert _slots(shape) == []


def test_two_equal_half_turn_notches_on_opposite_edges_are_not_a_slot():
    """Same radius, parallel axes, same depth: but no straight walls join them, so arcs alone are not a slot."""
    body = BRepPrimAPI_MakeBox(60.0, 40.0, 10.0).Shape()
    n1 = BRepPrimAPI_MakeCylinder(gp_Ax2(gp_Pnt(30, 0, -1), gp_Dir(0, 0, 1)), 6.0, 12.0).Shape()
    n2 = BRepPrimAPI_MakeCylinder(gp_Ax2(gp_Pnt(30, 40, -1), gp_Dir(0, 0, 1)), 6.0, 12.0).Shape()
    shape = BRepAlgoAPI_Cut(BRepAlgoAPI_Cut(body, n1).Shape(), n2).Shape()
    assert _slots(shape) == []
    rounds = [f for f in _features(shape) if f.type == "Edge" and f.variant == "round" and "sweep_deg" in f.params]
    assert [round(f.params["radius_mm"], 2) for f in rounds] == [6.0, 6.0]  # both kept, as rounds


def test_a_slot_is_reported_once_however_many_faces_its_ends_are_split_into():
    shape = _nurbs(_plate_with_slot())
    assert len(_slots(shape)) == 1
