"""
Tests for sheet_metal.features.lance -- the paired base-panel-enclosure
recognition test that promotes lancing_spike.py's candidates past
'ambiguous'. See that module's docstring for the full reasoning.

Real B-Rep throughout for the core topological primitive
(_bend_borders_inner_wire_of): a hole cut in the INTERIOR of a plate produces
a genuine inner wire, sharing an edge with the drilling cylinder's own wall
face -- exactly the enclosure signature a real lance's hinge produces at its
base panel. A notch cut so it merges into the plate's OUTER boundary produces
no inner wire at all -- exactly the signature an ordinary edge/corner tab
produces.

HONEST, DISCLOSED GAP (same as lancing_spike.py's own docstring): running
`detect_lances` end-to-end against a genuine fused, tilted lance solid was
not attempted here -- constructing a guaranteed-manifold fused solid of that
shape is itself nontrivial OCC boolean-operation work, independent of
whether this module's classification logic (verified below) is sound. This
file verifies the real topological primitive the promotion decision rests
on, not the full pipeline against a literal lance shape.
"""
import pytest

pytest.importorskip("OCC")

from OCC.Core.BRepPrimAPI import BRepPrimAPI_MakeBox, BRepPrimAPI_MakeCylinder  # noqa: E402
from OCC.Core.BRepAlgoAPI import BRepAlgoAPI_Cut  # noqa: E402
from OCC.Core.TopExp import TopExp_Explorer  # noqa: E402
from OCC.Core.TopAbs import TopAbs_FACE  # noqa: E402
from OCC.Core.TopoDS import topods  # noqa: E402
from OCC.Core.BRepAdaptor import BRepAdaptor_Surface  # noqa: E402
from OCC.Core.GeomAbs import GeomAbs_Plane, GeomAbs_Cylinder  # noqa: E402
from OCC.Core.BRepGProp import brepgprop  # noqa: E402
from OCC.Core.GProp import GProp_GProps  # noqa: E402
from OCC.Core.gp import gp_Pnt, gp_Ax2, gp_Dir  # noqa: E402

from sheet_metal.features.lance import _bend_borders_inner_wire_of, count_recognized  # noqa: E402

THICKNESS = 2.0
PLATE = 100.0


def _find_top_face(shape, min_area=50.0):
    best_face, best_area = None, 0.0
    exp = TopExp_Explorer(shape, TopAbs_FACE)
    while exp.More():
        face = topods.Face(exp.Current())
        adaptor = BRepAdaptor_Surface(face)
        if adaptor.GetType() == GeomAbs_Plane:
            n = adaptor.Plane().Axis().Direction()
            if abs(n.Z()) > 0.99 and float(adaptor.Plane().Location().Z()) > THICKNESS / 2:
                props = GProp_GProps()
                brepgprop.SurfaceProperties(face, props)
                if props.Mass() > best_area and props.Mass() > min_area:
                    best_area = props.Mass()
                    best_face = face
        exp.Next()
    return best_face


def _find_cylindrical_wall_face(shape):
    exp = TopExp_Explorer(shape, TopAbs_FACE)
    while exp.More():
        face = topods.Face(exp.Current())
        adaptor = BRepAdaptor_Surface(face)
        if adaptor.GetType() == GeomAbs_Cylinder:
            return face
        exp.Next()
    return None


def test_a_hole_cut_in_the_interior_produces_a_real_inner_wire_enclosure():
    """The exact signature a real lance's hinge produces at its base panel:
    a genuine hole (inner wire) fully surrounded by material, sharing an
    edge with the cavity wall face."""
    plate = BRepPrimAPI_MakeBox(PLATE, PLATE, THICKNESS).Shape()
    # Well inside the plate -- 50mm from every edge on a 100mm plate.
    drill = BRepPrimAPI_MakeCylinder(
        gp_Ax2(gp_Pnt(50.0, 50.0, -1.0), gp_Dir(0, 0, 1)), 10.0, THICKNESS + 2.0,
    ).Shape()
    shape = BRepAlgoAPI_Cut(plate, drill).Shape()

    top_face = _find_top_face(shape)
    wall_face = _find_cylindrical_wall_face(shape)
    assert top_face is not None and wall_face is not None

    assert _bend_borders_inner_wire_of(top_face, wall_face) is True


def test_a_notch_merged_into_the_outer_boundary_has_no_inner_wire():
    """The exact signature an ordinary edge/corner tab produces: the cavity
    is positioned so it overlaps the plate's own edge, merging into the
    OUTER boundary instead of creating a separate interior hole."""
    plate = BRepPrimAPI_MakeBox(PLATE, PLATE, THICKNESS).Shape()
    # Centered ON the plate's own edge (x=0) -- half the cylinder falls
    # outside the plate, so cutting it produces an edge notch, not a hole.
    drill = BRepPrimAPI_MakeCylinder(
        gp_Ax2(gp_Pnt(0.0, 50.0, -1.0), gp_Dir(0, 0, 1)), 10.0, THICKNESS + 2.0,
    ).Shape()
    shape = BRepAlgoAPI_Cut(plate, drill).Shape()

    top_face = _find_top_face(shape)
    wall_face = _find_cylindrical_wall_face(shape)
    assert top_face is not None and wall_face is not None

    assert _bend_borders_inner_wire_of(top_face, wall_face) is False


def test_unrelated_faces_never_falsely_report_an_enclosure():
    """Two real faces from a plain box, sharing no cavity relationship at
    all, must never be reported as an enclosure -- proves this isn't a
    permissive/always-true check."""
    plate = BRepPrimAPI_MakeBox(PLATE, PLATE, THICKNESS).Shape()
    top_face = _find_top_face(plate)
    assert top_face is not None

    # The plate's own outer wire has no inner wires at all, so any real
    # neighbor face shares nothing with an inner wire that doesn't exist.
    exp = TopExp_Explorer(plate, TopAbs_FACE)
    other_face = None
    while exp.More():
        f = topods.Face(exp.Current())
        if not f.IsSame(top_face):
            other_face = f
            break
        exp.Next()
    assert other_face is not None
    assert _bend_borders_inner_wire_of(top_face, other_face) is False


def test_count_recognized_only_counts_recognized_candidates():
    candidates = [
        {"recognition_status": "recognized"},
        {"recognition_status": "ambiguous"},
        {"recognition_status": "recognized"},
    ]
    assert count_recognized(candidates) == 2
