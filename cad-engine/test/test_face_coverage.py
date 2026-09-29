"""
Face-coverage accounting (machining/face_coverage.py).

The accounting logic is checked on plain data; the enumeration and the
recognizer wiring are checked on real OCC solids, where the expected face
count is the solid's own real face count.
"""
from dataclasses import dataclass, field
from typing import List

from OCC.Core.BRepAlgoAPI import BRepAlgoAPI_Cut
from OCC.Core.BRepPrimAPI import BRepPrimAPI_MakeBox, BRepPrimAPI_MakeCylinder
from OCC.Core.gp import gp_Ax2, gp_Dir, gp_Pnt
from OCC.Core.ShapeUpgrade import ShapeUpgrade_UnifySameDomain

from machining.face_coverage import account_face_coverage, enumerate_faces
from machining.machining_feature_recognizer import MachiningFeatureRecognizer


@dataclass
class _F:
    id: str
    face_ids: List[int] = field(default_factory=list)
    type: str = "SimpleHole"


def _faces(n):
    return [{"face_id": i, "surface_type": "Plane", "area_mm2": 10.0} for i in range(n)]


def test_every_face_is_claimed_or_listed_unclaimed():
    cov = account_face_coverage(_faces(4), [_F("a", [0, 1]), _F("b", [2])])
    assert cov["face_count"] == 4
    assert cov["claimed_face_count"] == 3
    assert [f["face_id"] for f in cov["unclaimed_faces"]] == [3]
    assert cov["claimed_area_fraction"] == 0.75


def test_a_face_owned_by_two_features_is_reported():
    cov = account_face_coverage(_faces(3), [_F("a", [0, 1]), _F("b", [1, 2])])
    assert cov["multiply_claimed_faces"] == [{"face_id": 1, "feature_ids": ["a", "b"]}]
    assert cov["unclaimed_face_count"] == 0


def test_surface_catch_all_regions_do_not_count_as_recognized_features():
    cov = account_face_coverage(
        _faces(4),
        [_F("hole", [0], "SimpleHole"), _F("rest", [1, 2, 3], "PlanarFace")],
    )
    assert cov["claimed_face_count"] == 4
    assert cov["discrete_face_count"] == 1
    assert cov["discrete_area_fraction"] == 0.25


def test_face_ids_outside_the_shape_do_not_inflate_coverage():
    cov = account_face_coverage(_faces(2), [_F("a", [0, 7, 99])])
    assert cov["claimed_face_count"] == 1
    assert [f["face_id"] for f in cov["unclaimed_faces"]] == [1]


def _unify(shape):
    u = ShapeUpgrade_UnifySameDomain(shape, True, True, True)
    u.Build()
    return u.Shape()


def _plate_with_through_hole():
    box = BRepPrimAPI_MakeBox(60.0, 40.0, 10.0).Shape()
    hole = BRepPrimAPI_MakeCylinder(gp_Ax2(gp_Pnt(30.0, 20.0, -1.0), gp_Dir(0, 0, 1)), 4.0, 12.0).Shape()
    return _unify(BRepAlgoAPI_Cut(box, hole).Shape())


def test_enumerate_faces_reports_real_surface_types_and_areas():
    faces = enumerate_faces(_plate_with_through_hole())
    types = sorted({f["surface_type"] for f in faces})
    assert types == ["Cylinder", "Plane"]
    assert [f["face_id"] for f in faces] == list(range(len(faces)))
    cyl_area = sum(f["area_mm2"] for f in faces if f["surface_type"] == "Cylinder")
    assert abs(cyl_area - 2 * 3.14159265 * 4.0 * 10.0) < 0.5


def test_recognizer_reports_coverage_over_every_real_face():
    shape = _plate_with_through_hole()
    tree = MachiningFeatureRecognizer().recognize(shape, "milled")
    faces = enumerate_faces(shape)
    cov = tree.coverage
    assert cov["face_count"] == len(faces)
    assert cov["claimed_face_count"] + cov["unclaimed_face_count"] == len(faces)
    # The bore wall is owned by the hole feature.
    hole = next(f for f in tree.features if f.type == "SimpleHole")
    cyl_ids = {f["face_id"] for f in faces if f["surface_type"] == "Cylinder"}
    assert cyl_ids <= set(hole.face_ids)
    unclaimed_ids = {f["face_id"] for f in cov["unclaimed_faces"]}
    assert not (cyl_ids & unclaimed_ids)

    d = tree.to_dict()
    assert d["unclaimed_face_ids"] == sorted(unclaimed_ids)
    assert d["face_coverage"]["face_count"] == len(faces)
