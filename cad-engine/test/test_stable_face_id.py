"""
Tests for shared.stable_face_id — content-based face identity that survives
a change in OCC's runtime face enumeration order.

Real B-Rep throughout: the SAME box geometry is built two different ways
(a single BRepPrimAPI_MakeBox call vs. two half-boxes fused with
BRepAlgoAPI_Fuse) — a real, verified way to force OCC to enumerate faces in
a different order for topologically-equivalent geometry, proving the stable
id survives what a STEP re-export/re-tessellation would also do.
"""
import math

import pytest

pytest.importorskip("OCC")

from OCC.Core.BRepPrimAPI import BRepPrimAPI_MakeBox  # noqa: E402
from OCC.Core.BRepAlgoAPI import BRepAlgoAPI_Fuse  # noqa: E402
from OCC.Core.ShapeUpgrade import ShapeUpgrade_UnifySameDomain  # noqa: E402
from OCC.Core.BRepBndLib import brepbndlib  # noqa: E402
from OCC.Core.Bnd import Bnd_Box  # noqa: E402
from OCC.Core.TopExp import TopExp_Explorer  # noqa: E402
from OCC.Core.TopAbs import TopAbs_FACE  # noqa: E402
from OCC.Core.TopoDS import topods  # noqa: E402
from OCC.Core.BRepGProp import brepgprop  # noqa: E402
from OCC.Core.GProp import GProp_GProps  # noqa: E402
from OCC.Core.gp import gp_Pnt  # noqa: E402

from shared.stable_face_id import compute_stable_face_id, build_stable_face_id_map  # noqa: E402

BOX_DIMS = (100.0, 80.0, 2.0)


def _make_box_single_call():
    return BRepPrimAPI_MakeBox(*BOX_DIMS).Shape()


def _make_box_fused_halves():
    """The SAME 100x80x2 box, built by fusing two 50x80x2 halves along x=50.
    A real, different construction graph -- OCC's face enumeration order for
    the fused result is not guaranteed (or expected) to match the single-call
    box's order."""
    left = BRepPrimAPI_MakeBox(gp_Pnt(0.0, 0.0, 0.0), 50.0, 80.0, 2.0).Shape()
    right = BRepPrimAPI_MakeBox(gp_Pnt(50.0, 0.0, 0.0), 50.0, 80.0, 2.0).Shape()
    fused = BRepAlgoAPI_Fuse(left, right).Shape()
    # A raw boolean fuse leaves the 4 side faces split into two coplanar
    # patches at the internal x=50 seam (10 faces, not 6) -- a real, standard
    # OCC cleanup step merges same-domain coplanar/co-cylindrical neighbors
    # back into single faces, which is what a real CAD kernel's own face
    # count for this shape would be.
    unify = ShapeUpgrade_UnifySameDomain(fused, True, True, True)
    unify.Build()
    return unify.Shape()


def _face_signatures(shape):
    """(area, centroid) per face, in enumeration order -- used only to match
    corresponding faces between the two constructions for test assertions,
    not part of the module under test."""
    sigs = []
    exp = TopExp_Explorer(shape, TopAbs_FACE)
    while exp.More():
        face = topods.Face(exp.Current())
        props = GProp_GProps()
        brepgprop.SurfaceProperties(face, props)
        cg = props.CentreOfMass()
        sigs.append((round(props.Mass(), 1), round(cg.X(), 1), round(cg.Y(), 1), round(cg.Z(), 1)))
        exp.Next()
    return sigs


def test_same_geometry_built_two_different_ways_yields_matching_stable_ids():
    """The real regression this module exists to prevent: the SAME physical
    face must get the SAME stable id regardless of which OCC construction
    graph produced it (a stand-in for a STEP re-export/re-tessellation
    changing enumeration order)."""
    shape_a = _make_box_single_call()
    shape_b = _make_box_fused_halves()

    ids_a = build_stable_face_id_map(shape_a)
    ids_b = build_stable_face_id_map(shape_b)
    sigs_a = _face_signatures(shape_a)
    sigs_b = _face_signatures(shape_b)

    assert len(ids_a) == 6, "a plain box has 6 faces"
    assert len(ids_b) == 6, "two fused halves of the same box must still present 6 outer faces"

    # Match faces between the two shapes by their own real geometry (area +
    # centroid), independent of enumeration order -- this is the ground
    # truth the stable id is supposed to reproduce without needing this
    # matching step itself.
    for idx_a, sig in enumerate(sigs_a):
        idx_b = sigs_b.index(sig)
        assert ids_a[idx_a] == ids_b[idx_b], (
            f"face at {sig} must share a stable id across constructions; "
            f"got {ids_a[idx_a]} (single-call idx {idx_a}) vs {ids_b[idx_b]} (fused idx {idx_b})"
        )


def test_different_real_faces_get_different_stable_ids():
    shape = _make_box_single_call()
    ids = build_stable_face_id_map(shape)
    assert len(set(ids.values())) == len(ids), "every real face of a box is geometrically distinct"


def test_stable_id_is_deterministic_across_repeated_calls():
    shape = _make_box_single_call()
    first = build_stable_face_id_map(shape)
    second = build_stable_face_id_map(shape)
    assert first == second


def test_ordinal_index_is_not_required_to_match_for_the_test_to_be_meaningful():
    """Proves the fused-halves construction actually DID reorder faces --
    otherwise the positive test above would be trivially true and prove
    nothing."""
    sigs_a = _face_signatures(_make_box_single_call())
    sigs_b = _face_signatures(_make_box_fused_halves())
    reordered = any(sigs_a[i] != sigs_b[i] for i in range(min(len(sigs_a), len(sigs_b))))
    assert reordered, "test setup did not actually change enumeration order -- strengthen the fixture"


def test_empty_shape_returns_empty_map():
    from OCC.Core.TopoDS import TopoDS_Shape
    assert build_stable_face_id_map(TopoDS_Shape()) == {}
