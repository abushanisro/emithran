"""
Hole recognition on synthetic parts with known answers: a hole is one feature however many faces carry its wall, a partial arc is not a hole, a
counterbore is one multi-step hole, blind and through are told apart, and two holes in line on one axis stay two.

Run: docker compose -f docker-compose.dev.yml --profile test run --rm tests pytest test/test_plastic_recognition_holes.py
"""
import math

import pytest
from OCC.Core.BRepAlgoAPI import BRepAlgoAPI_Cut, BRepAlgoAPI_Fuse
from OCC.Core.BRepFilletAPI import BRepFilletAPI_MakeFillet
from OCC.Core.BRepPrimAPI import BRepPrimAPI_MakeBox, BRepPrimAPI_MakeCone, BRepPrimAPI_MakeCylinder
from OCC.Core.gp import gp_Ax2, gp_Dir, gp_Pnt
from OCC.Core.TopAbs import TopAbs_EDGE
from OCC.Core.TopExp import TopExp_Explorer
from OCC.Core.TopoDS import topods

from injection_molding.recognition.holes import cylinders, recognize_holes
from injection_molding.recognition.mesh import tessellate_faces

Z = (0.0, 0.0, 1.0)


def box(x, y, z, at=(0, 0, 0)):
    return BRepPrimAPI_MakeBox(gp_Pnt(*at), x, y, z).Shape()


def cyl(at, axis, radius, length, angle=None):
    ax = gp_Ax2(gp_Pnt(*at), gp_Dir(*axis))
    return (BRepPrimAPI_MakeCylinder(ax, radius, length, angle) if angle else BRepPrimAPI_MakeCylinder(ax, radius, length)).Shape()


def cut(shape, *tools):
    for t in tools:
        shape = BRepAlgoAPI_Cut(shape, t).Shape()
    return shape


def holes_of(shape, pull=Z):
    return recognize_holes(tessellate_faces(shape, 0.05), pull)


def test_a_through_hole_is_one_through_hole():
    out = holes_of(cut(box(100, 60, 10), cyl((50, 30, -1), Z, 5, 12)))
    assert len(out["holes"]) == 1
    h = out["holes"][0]
    assert (h["feature_type"], h["variant"]) == ("SimpleHole", "through")
    assert h["diameter_mm"] == pytest.approx(10.0, abs=0.05)
    assert h["depth_mm"] == pytest.approx(10.0, abs=0.1)
    assert h["angle_to_pull_deg"] == pytest.approx(0.0, abs=0.1)


def test_a_blind_hole_is_blind_and_its_depth_to_diameter_is_measured():
    out = holes_of(cut(box(100, 60, 10), cyl((50, 30, 3), Z, 2, 8)))  # 7 mm deep from the top face, flat bottom
    h = out["holes"][0]
    assert h["variant"] == "blind"
    assert h["depth_mm"] == pytest.approx(7.0, abs=0.1)
    assert h["depth_to_diameter"] == pytest.approx(7.0 / 4.0, abs=0.05)


def test_a_wall_made_of_two_faces_counts_as_one_hole_and_both_faces_are_listed():
    plate = box(100, 60, 10)
    bore = BRepAlgoAPI_Fuse(cyl((50, 30, -1), Z, 4, 12, angle=math.pi), _rotated_half((50, 30, -1), 4, 12)).Shape()
    out = holes_of(cut(plate, bore))
    cyls = [f for f in tessellate_faces(cut(plate, bore), 0.05) if f.surface == "cylinder"]
    assert len(cyls) >= 1
    assert len(out["holes"]) == 1
    assert out["holes"][0]["diameter_mm"] == pytest.approx(8.0, abs=0.05)


def _rotated_half(at, radius, length):
    from OCC.Core.gp import gp_Ax1, gp_Trsf
    from OCC.Core.BRepBuilderAPI import BRepBuilderAPI_Transform

    half = cyl(at, Z, radius, length, angle=math.pi)
    t = gp_Trsf()
    t.SetRotation(gp_Ax1(gp_Pnt(*at), gp_Dir(*Z)), math.pi)
    return BRepBuilderAPI_Transform(half, t, True).Shape()


def test_a_counterbored_hole_is_one_multi_step_hole_with_both_steps():
    out = holes_of(cut(box(100, 60, 10), cyl((50, 30, -1), Z, 2.5, 12), cyl((50, 30, 6), Z, 5, 5)))  # 5 mm bore, 9 mm counterbore 4 mm deep
    assert len(out["holes"]) == 1
    h = out["holes"][0]
    assert h["feature_type"] == "MultiStepHole"
    assert h["variant"] == "through"
    assert sorted(s["diameter_mm"] for s in h["steps"]) == pytest.approx([5.0, 10.0], abs=0.1)
    assert h["diameter_mm"] == pytest.approx(5.0, abs=0.05)  # the controlling (smallest) diameter


def test_a_countersunk_hole_stays_a_simple_hole_with_its_cone_listed_as_a_step():
    cone = BRepPrimAPI_MakeCone(gp_Ax2(gp_Pnt(50, 30, 7), gp_Dir(*Z)), 2.5, 5.0, 3.0).Shape()  # 90 deg countersink flaring to the top face
    out = holes_of(cut(box(100, 60, 10), cyl((50, 30, -1), Z, 2.5, 12), cone))
    assert len(out["holes"]) == 1
    h = out["holes"][0]
    assert h["feature_type"] == "SimpleHole"
    assert any(s["kind"] == "cone" for s in h["steps"])


def test_a_hole_in_a_side_wall_reports_its_angle_to_the_pull():
    out = holes_of(cut(box(100, 60, 20), cyl((101, 30, 10), (-1, 0, 0), 3, 20)), pull=Z)
    h = out["holes"][0]
    assert h["variant"] == "blind"
    assert h["angle_to_pull_deg"] == pytest.approx(90.0, abs=0.5)


def test_two_holes_in_line_on_one_axis_stay_two_holes():
    # Blind holes from both ends of a plate along X: same axis line, same radius, a solid web between them.
    out = holes_of(cut(box(100, 60, 20), cyl((-1, 30, 10), (1, 0, 0), 3, 21), cyl((101, 30, 10), (-1, 0, 0), 3, 21)), pull=Z)
    assert len(out["holes"]) == 2
    assert all(h["variant"] == "blind" for h in out["holes"])
    assert all(h["depth_mm"] == pytest.approx(20.0, abs=0.2) for h in out["holes"])


def test_a_rounded_corner_is_an_arc_not_a_hole():
    plate = box(100, 60, 10)
    fillet = BRepFilletAPI_MakeFillet(plate)
    exp = TopExp_Explorer(plate, TopAbs_EDGE)
    edges = []
    while exp.More():
        edges.append(topods.Edge(exp.Current()))
        exp.Next()
    from OCC.Core.BRep import BRep_Tool
    for e in edges:
        a, b = BRep_Tool.Curve(e)[0], None
        p = BRep_Tool.Pnt(topods.Vertex(_first_vertex(e)))
        if abs(p.X()) < 1e-6 and abs(p.Y()) < 1e-6:  # the vertical edge at the origin corner
            fillet.Add(4.0, e)
            break
    rounded = fillet.Shape()
    out = holes_of(rounded)
    assert out["holes"] == []
    assert out["arcs"]["count"] >= 1
    assert out["arcs"]["sweep_deg_range"][1] == pytest.approx(90.0, abs=6.0)


def _first_vertex(edge):
    from OCC.Core.TopExp import topexp

    return topexp.FirstVertex(edge)


def test_a_pin_on_a_plate_is_a_boss_not_a_hole():
    out = holes_of(BRepAlgoAPI_Fuse(box(100, 60, 5), cyl((50, 30, 5), Z, 3, 8)).Shape())
    assert out["holes"] == []
    assert len(out["bosses"]) == 1
    assert out["bosses"][0]["diameter_mm"] == pytest.approx(6.0, abs=0.05)
    assert out["bosses"][0]["length_mm"] == pytest.approx(8.0, abs=0.1)


def test_a_cone_with_no_bore_is_not_a_hole():
    out = holes_of(cut(box(100, 60, 10), BRepPrimAPI_MakeCone(gp_Ax2(gp_Pnt(50, 30, 6), gp_Dir(*Z)), 0.5, 4.0, 5.0).Shape()))
    assert out["holes"] == []
    assert out["cone_only_dimples"] >= 1


def test_the_census_of_cylinders_distinguishes_faces_from_cylinders():
    shape = cut(box(100, 60, 10), cyl((50, 30, -1), Z, 4, 12))
    meshes = tessellate_faces(shape, 0.05)
    assert len(cylinders(meshes)) == 1
