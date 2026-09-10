"""
Tests for sheet_metal.features.formed_feature -- the paired-offset-wall
recognition test that promotes forming_spike.py's candidates past
'ambiguous'. See that module's docstring for the full reasoning: a blind
hole leaves the sheet's back face untouched; a real dimple/emboss displaces
material on both faces, which shows up as a local void (inner wire) in the
back face's own boundary at the same footprint.

Real B-Rep throughout, no STEP file (none exists anywhere in this repo) --
same in-memory construction convention as test_forming_spike.py and
test_rolled_form.py.
"""
import math

import pytest

pytest.importorskip("OCC")

from OCC.Core.BRepPrimAPI import BRepPrimAPI_MakeBox, BRepPrimAPI_MakeCylinder  # noqa: E402
from OCC.Core.BRepAlgoAPI import BRepAlgoAPI_Cut  # noqa: E402
from OCC.Core.TopExp import TopExp_Explorer  # noqa: E402
from OCC.Core.TopAbs import TopAbs_FACE  # noqa: E402
from OCC.Core.TopoDS import topods  # noqa: E402
from OCC.Core.BRepAdaptor import BRepAdaptor_Surface  # noqa: E402
from OCC.Core.GeomAbs import GeomAbs_Plane  # noqa: E402
from OCC.Core.BRepGProp import brepgprop  # noqa: E402
from OCC.Core.GProp import GProp_GProps  # noqa: E402
from OCC.Core.gp import gp_Pnt, gp_Ax2, gp_Dir  # noqa: E402
from OCC.Core.Bnd import Bnd_Box  # noqa: E402
from OCC.Core.BRepBndLib import brepbndlib  # noqa: E402

from sheet_metal.features.formed_feature import (  # noqa: E402
    detect_formed_features,
    count_recognized,
    _find_back_face,
    _back_face_has_local_void,
    SHALLOW_EMBOSS_DEPTH_MULTIPLE,
    DEEP_DIMPLE_MAX_DEPTH_MULTIPLE,
)

THICKNESS = 2.0
PLATE = 200.0


def _find_face_near_z(shape, target_z, min_area=100.0):
    """Largest planar face whose plane sits near target_z, oriented +/-Z."""
    best_face, best_area = None, 0.0
    exp = TopExp_Explorer(shape, TopAbs_FACE)
    while exp.More():
        face = topods.Face(exp.Current())
        adaptor = BRepAdaptor_Surface(face)
        if adaptor.GetType() == GeomAbs_Plane:
            n = adaptor.Plane().Axis().Direction()
            if abs(n.Z()) > 0.99:
                loc = adaptor.Plane().Location()
                if abs(float(loc.Z()) - target_z) < 0.5:
                    props = GProp_GProps()
                    brepgprop.SurfaceProperties(face, props)
                    if props.Mass() > best_area and props.Mass() > min_area:
                        best_area = props.Mass()
                        best_face = face
        exp.Next()
    return best_face


def _bbox_of(shape):
    box = Bnd_Box()
    brepbndlib.Add(shape, box)
    xmin, ymin, zmin, xmax, ymax, zmax = box.Get()
    return {"xmin": xmin, "xmax": xmax, "ymin": ymin, "ymax": ymax, "zmin": zmin, "zmax": zmax}


def _top_pocket_cutter(cx, cy, radius, depth, thickness=THICKNESS):
    """A cylinder that removes material from the TOP face down to `depth`."""
    axis = gp_Ax2(gp_Pnt(cx, cy, thickness + 0.5), gp_Dir(0, 0, -1))
    return BRepPrimAPI_MakeCylinder(axis, radius, depth + 0.5).Shape()


def _bottom_pocket_cutter(cx, cy, radius, depth):
    """A cylinder that removes material from the BOTTOM face up to `depth`."""
    axis = gp_Ax2(gp_Pnt(cx, cy, -0.5), gp_Dir(0, 0, 1))
    return BRepPrimAPI_MakeCylinder(axis, radius, depth + 0.5).Shape()


def _make_plate():
    return BRepPrimAPI_MakeBox(PLATE, PLATE, THICKNESS).Shape()


def test_real_paired_offset_dimple_is_recognized():
    """A genuine paired-offset-wall structure: material worked from BOTH
    faces at the same XY. The front cavity is exactly forming_spike's own
    existing shallow-blind-cavity test case; the back also has a local void
    at that footprint -- the real, topological signature this module exists
    to find."""
    front_depth = THICKNESS * 0.7   # 1.4mm -- inside forming_spike's accepted range
    back_depth = THICKNESS * 0.15   # 0.3mm -- well clear of the front cavity's floor

    shape = _make_plate()
    shape = BRepAlgoAPI_Cut(shape, _top_pocket_cutter(100.0, 100.0, 5.0, front_depth)).Shape()
    shape = BRepAlgoAPI_Cut(shape, _bottom_pocket_cutter(100.0, 100.0, 4.0, back_depth)).Shape()

    dominant_face = _find_face_near_z(shape, THICKNESS)
    assert dominant_face is not None
    bbox = _bbox_of(shape)

    found = detect_formed_features(shape, dominant_face, bbox, THICKNESS)
    assert len(found) == 1, f"expected exactly one candidate in forming_spike's accepted depth range; got {found}"
    c = found[0]
    assert c["recognition_status"] == "recognized"
    assert "opposite face" in c["recognition_evidence"]
    assert count_recognized(found) == 1


def test_real_ordinary_blind_pocket_stays_ambiguous():
    """Same front cavity, but the back is left completely flat and
    undisturbed -- forming_spike.py's own existing baseline case. Must stay
    'ambiguous', unchanged."""
    front_depth = THICKNESS * 0.7

    shape = _make_plate()
    shape = BRepAlgoAPI_Cut(shape, _top_pocket_cutter(100.0, 100.0, 5.0, front_depth)).Shape()

    dominant_face = _find_face_near_z(shape, THICKNESS)
    assert dominant_face is not None
    bbox = _bbox_of(shape)

    found = detect_formed_features(shape, dominant_face, bbox, THICKNESS)
    assert len(found) == 1
    assert found[0]["recognition_status"] == "ambiguous"
    assert count_recognized(found) == 0


def test_unrelated_back_feature_does_not_promote_a_distant_front_candidate():
    """A back-face void exists, but nowhere near the front candidate's own
    footprint -- proves the overlap test is spatially discriminating, not
    'any back feature anywhere recognizes everything'."""
    front_depth = THICKNESS * 0.7
    back_depth = THICKNESS * 0.15

    shape = _make_plate()
    shape = BRepAlgoAPI_Cut(shape, _top_pocket_cutter(100.0, 100.0, 5.0, front_depth)).Shape()
    # Bottom pocket far from (100, 100) -- an unrelated feature elsewhere on the back.
    shape = BRepAlgoAPI_Cut(shape, _bottom_pocket_cutter(170.0, 170.0, 4.0, back_depth)).Shape()

    dominant_face = _find_face_near_z(shape, THICKNESS)
    assert dominant_face is not None
    bbox = _bbox_of(shape)

    found = detect_formed_features(shape, dominant_face, bbox, THICKNESS)
    assert len(found) == 1, f"the distant back pocket must not itself become a front candidate; got {found}"
    assert found[0]["centroid_mm"][0] == pytest.approx(100.0, abs=0.5)
    assert found[0]["recognition_status"] == "ambiguous"


def test_recognized_candidate_carries_the_sourced_depth_classification():
    """Once recognized, depth is classified against the real reference-data
    multipliers (memory/sheetmetal/sheet_metal_variables.json), not used to
    decide recognition itself."""
    front_depth = THICKNESS * 0.7  # 1.4mm = 0.7x thickness -- deeper than the shallow (1x) boundary is false here
    back_depth = THICKNESS * 0.15

    shape = _make_plate()
    shape = BRepAlgoAPI_Cut(shape, _top_pocket_cutter(100.0, 100.0, 5.0, front_depth)).Shape()
    shape = BRepAlgoAPI_Cut(shape, _bottom_pocket_cutter(100.0, 100.0, 4.0, back_depth)).Shape()

    dominant_face = _find_face_near_z(shape, THICKNESS)
    bbox = _bbox_of(shape)
    found = detect_formed_features(shape, dominant_face, bbox, THICKNESS)

    assert len(found) == 1
    c = found[0]
    assert c["depth_to_thickness_ratio"] == pytest.approx(0.7, abs=0.05)
    assert c["is_shallow"] is True  # 0.7 <= SHALLOW_EMBOSS_DEPTH_MULTIPLE (1.0)
    assert c["exceeds_typical_dimple_depth"] is False  # 0.7 <= DEEP_DIMPLE_MAX_DEPTH_MULTIPLE (4.0)
    assert SHALLOW_EMBOSS_DEPTH_MULTIPLE == 1.0
    assert DEEP_DIMPLE_MAX_DEPTH_MULTIPLE == 4.0


def test_find_back_face_pairs_the_real_antiparallel_plane():
    """Unit test of the back-face finder alone: for a plain plate (no
    cavities at all), the back face it finds must be the real bottom face,
    not the top face itself or nothing."""
    shape = _make_plate()
    dominant_face = _find_face_near_z(shape, THICKNESS)
    back = _find_back_face(shape, dominant_face, THICKNESS)
    assert back is not None
    assert not back.IsSame(dominant_face)

    adaptor = BRepAdaptor_Surface(back)
    loc = adaptor.Plane().Location()
    assert float(loc.Z()) == pytest.approx(0.0, abs=0.01)


def test_back_face_has_local_void_direct_unit_check():
    """Direct check of the overlap predicate against a real back face with
    one real inner-wire void, independent of the full detect_formed_features
    pipeline above."""
    shape = _make_plate()
    shape = BRepAlgoAPI_Cut(shape, _bottom_pocket_cutter(50.0, 50.0, 6.0, THICKNESS * 0.15)).Shape()
    back_face = _find_face_near_z(shape, 0.0)
    assert back_face is not None

    assert _back_face_has_local_void(back_face, (50.0, 50.0, 0.0), 6.0) is True
    assert _back_face_has_local_void(back_face, (150.0, 150.0, 0.0), 6.0) is False


def test_returns_candidates_unchanged_when_no_candidates_exist():
    """No blind cavity at all -- detect_formed_features must not error or
    fabricate anything; it returns the empty candidate list untouched."""
    shape = _make_plate()
    dominant_face = _find_face_near_z(shape, THICKNESS)
    bbox = _bbox_of(shape)
    assert detect_formed_features(shape, dominant_face, bbox, THICKNESS) == []
