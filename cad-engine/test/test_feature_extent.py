"""Real B-Rep tests for shared/feature_extent.py: expected values are the
solids' own exact dimensions."""
import math

import pytest

pytest.importorskip("OCC")

from OCC.Core.BRepAlgoAPI import BRepAlgoAPI_Cut
from OCC.Core.BRepBuilderAPI import BRepBuilderAPI_Transform
from OCC.Core.BRepPrimAPI import BRepPrimAPI_MakeBox, BRepPrimAPI_MakeCylinder
from OCC.Core.gp import gp_Ax1, gp_Ax2, gp_Dir, gp_Pnt, gp_Trsf

from shared.feature_extent import _faces_by_ordinal, annotate_occurrence_extents, faces_extent_mm, faces_extents_mm


def _box():
    return BRepPrimAPI_MakeBox(50.0, 40.0, 20.0).Shape()


def test_each_box_face_extent_is_its_longest_side():
    ext = sorted(round(faces_extent_mm([f]), 3) for f in _faces_by_ordinal(_box()))
    # 2 faces 40x20, 2 faces 50x20, 2 faces 50x40.
    assert ext == pytest.approx([40, 40, 50, 50, 50, 50], abs=1e-3)


def test_extent_does_not_change_when_the_part_is_rotated():
    t = gp_Trsf()
    t.SetRotation(gp_Ax1(gp_Pnt(0, 0, 0), gp_Dir(0, 0, 1)), 0.6)
    rotated = BRepBuilderAPI_Transform(_box(), t, True).Shape()
    ext = sorted(round(faces_extent_mm([f]), 3) for f in _faces_by_ordinal(rotated))
    assert ext == pytest.approx([40, 40, 50, 50, 50, 50], abs=1e-2)


def test_several_faces_measure_together():
    faces = _faces_by_ordinal(_box())
    # All six faces together span the box: longest side 50.
    assert faces_extent_mm(faces) == pytest.approx(50.0, abs=1e-3)


def test_cylindrical_hole_wall_extent_is_its_longer_dimension():
    hole = BRepPrimAPI_MakeCylinder(gp_Ax2(gp_Pnt(25, 20, -1), gp_Dir(0, 0, 1)), 5.0, 22.0).Shape()
    part = BRepAlgoAPI_Cut(_box(), hole).Shape()
    from OCC.Core.BRepAdaptor import BRepAdaptor_Surface
    from OCC.Core.GeomAbs import GeomAbs_Cylinder
    cyl = [f for f in _faces_by_ordinal(part) if BRepAdaptor_Surface(f).GetType() == GeomAbs_Cylinder]
    assert cyl
    # 10 mm bore, 20 mm through the box: the wall spans 20 mm.
    assert faces_extent_mm(cyl) == pytest.approx(20.0, abs=0.05)


def test_annotate_adds_extent_only_where_faces_are_measurable():
    feats = [{"occurrences": [{"face_ids": [0]}, {"face_ids": []}, {"face_ids": [999]}]}]
    annotate_occurrence_extents(_box(), feats)
    occ = feats[0]["occurrences"]
    assert occ[0]["extent_mm"] > 0
    assert "extent_mm" not in occ[1] and "extent_mm" not in occ[2]


def test_planar_face_sides_are_its_length_and_width():
    sides = sorted((tuple(round(x, 2) for x in faces_extents_mm([f])) for f in _faces_by_ordinal(_box())))
    # 40x20, 50x20, 50x40 faces (two each), third side ~0.
    assert sides[0][:2] == (40.0, 20.0) and sides[-1][:2] == (50.0, 40.0)
    assert all(s[2] == pytest.approx(0.0, abs=1e-3) for s in sides)
