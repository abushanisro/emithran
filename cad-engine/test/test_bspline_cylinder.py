"""
Cylinders in B-spline faces (shared/bspline_cylinder.py, used by collect_cylinders).

Reported part: a STEP whose 525 faces were ALL written as B-spline surfaces. The recognizers only
read analytic cylinders, so it got no holes, no diameters, and one CurvedSurface over the whole
part. Real OCC solids here, converted to B-splines with BRepBuilderAPI_NurbsConvert (the same
loss of surface type), with sizes known from how each solid is built.
"""
import math

import pytest
from OCC.Core.BRepAlgoAPI import BRepAlgoAPI_Cut
from OCC.Core.BRepBuilderAPI import BRepBuilderAPI_NurbsConvert
from OCC.Core.BRepAdaptor import BRepAdaptor_Surface
from OCC.Core.BRepFilletAPI import BRepFilletAPI_MakeFillet
from OCC.Core.BRepPrimAPI import BRepPrimAPI_MakeBox, BRepPrimAPI_MakeCone, BRepPrimAPI_MakeCylinder, BRepPrimAPI_MakeSphere
from OCC.Core.GeomAbs import GeomAbs_BSplineSurface, GeomAbs_Cylinder
from OCC.Core.gp import gp_Ax2, gp_Dir, gp_Pnt
from OCC.Core.TopAbs import TopAbs_EDGE, TopAbs_FACE
from OCC.Core.TopExp import TopExp_Explorer
from OCC.Core.TopoDS import topods

from machining.machining_feature_recognizer import MachiningFeatureRecognizer
from shared.bspline_cylinder import fit_cylinder


def _faces(shape):
    exp = TopExp_Explorer(shape, TopAbs_FACE)
    while exp.More():
        yield topods.Face(exp.Current())
        exp.Next()


def _nurbs(shape):
    return BRepBuilderAPI_NurbsConvert(shape, True).Shape()


def _plate_with_holes():
    """60 x 40 x 20 block; Ø10 through hole along Z; Ø6 blind hole 8 deep from the top."""
    body = BRepPrimAPI_MakeBox(60.0, 40.0, 20.0).Shape()
    through = BRepPrimAPI_MakeCylinder(gp_Ax2(gp_Pnt(15, 20, -1), gp_Dir(0, 0, 1)), 5.0, 22.0).Shape()
    blind = BRepPrimAPI_MakeCylinder(gp_Ax2(gp_Pnt(45, 20, 12), gp_Dir(0, 0, 1)), 3.0, 9.0).Shape()
    return BRepAlgoAPI_Cut(BRepAlgoAPI_Cut(body, through).Shape(), blind).Shape()


def _filleted_block(radius=2.0):
    body = BRepPrimAPI_MakeBox(40.0, 30.0, 10.0).Shape()
    fillet = BRepFilletAPI_MakeFillet(body)
    exp = TopExp_Explorer(body, TopAbs_EDGE)
    edge = topods.Edge(exp.Current())
    fillet.Add(radius, edge)
    return fillet.Shape()


def _fitted(shape):
    return [(f, fit_cylinder(f)) for f in _faces(shape)]


def test_the_conversion_really_removes_the_analytic_cylinder():
    """Guards the fixture: if NurbsConvert kept the surface type the tests below would prove nothing."""
    types = {BRepAdaptor_Surface(f).GetType() for f in _faces(_nurbs(_plate_with_holes()))}
    assert GeomAbs_Cylinder not in types
    assert GeomAbs_BSplineSurface in types


def test_bores_come_back_with_their_real_radius_and_as_internal():
    radii = sorted(round(c.radius, 3) for _, c in _fitted(_nurbs(_plate_with_holes())) if c)
    assert radii == [3.0, 5.0] or radii == [3.0, 3.0, 5.0, 5.0]  # one face or two halves per bore
    assert all(c.internal for _, c in _fitted(_nurbs(_plate_with_holes())) if c)


def test_a_full_bore_reports_a_full_turn_and_a_half_reports_a_half_turn():
    for _, c in _fitted(_nurbs(_plate_with_holes())):
        if c:
            assert c.u_range == pytest.approx(2 * math.pi, abs=0.05) or c.u_range == pytest.approx(math.pi, abs=0.05)


def test_the_axis_is_the_holes_real_axis():
    for _, c in _fitted(_nurbs(_plate_with_holes())):
        if c:
            assert abs(c.axis[2]) == pytest.approx(1.0, abs=1e-6)
            assert (round(c.location[0], 2), round(c.location[1], 2)) in {(15.0, 20.0), (45.0, 20.0)}


def test_an_outside_fillet_is_a_convex_cylinder_with_its_real_radius():
    found = [c for _, c in _fitted(_nurbs(_filleted_block(2.0))) if c]
    assert len(found) == 1
    assert found[0].radius == pytest.approx(2.0, abs=1e-3)
    assert found[0].internal is False
    assert found[0].u_range == pytest.approx(math.pi / 2, abs=0.05)


@pytest.mark.parametrize("make", [
    lambda: BRepPrimAPI_MakeSphere(10.0).Shape(),
    lambda: BRepPrimAPI_MakeCone(8.0, 3.0, 20.0).Shape(),
    lambda: BRepPrimAPI_MakeBox(10.0, 10.0, 10.0).Shape(),
])
def test_spheres_cones_and_planes_are_not_cylinders(make):
    for face, c in _fitted(_nurbs(make())):
        # the cone and the sphere also have flat end caps / seams; none of it is a cylinder
        assert c is None, BRepAdaptor_Surface(face).GetType()


def test_the_recognizer_finds_the_same_holes_after_the_surfaces_are_converted():
    def holes(shape):
        tree = MachiningFeatureRecognizer().recognize(shape, "milled")
        return sorted((f.variant, round(f.params["diameter_mm"], 2)) for f in tree.features if f.type == "SimpleHole")

    original = holes(_plate_with_holes())
    converted = holes(_nurbs(_plate_with_holes()))
    assert original, "the analytic solid must yield holes, or the comparison is empty"
    assert converted == original


def test_converted_hole_features_carry_real_faces_of_the_converted_shape():
    shape = _nurbs(_plate_with_holes())
    count = sum(1 for _ in _faces(shape))
    tree = MachiningFeatureRecognizer().recognize(shape, "milled")
    for f in tree.features:
        if f.type == "SimpleHole":
            assert f.face_ids and all(0 <= i < count for i in f.face_ids)
