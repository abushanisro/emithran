"""
Face typing (PlanarFace, CurvedWall, CurvedSurface), the plastic feature graph and its vocabulary gate, and the extractor carrying them next to the
unchanged legacy fields.

Run: docker compose -f docker-compose.dev.yml --profile test run --rm tests pytest test/test_plastic_feature_graph.py
"""
import math

import pytest
from OCC.Core.BRepAlgoAPI import BRepAlgoAPI_Common, BRepAlgoAPI_Cut
from OCC.Core.BRepPrimAPI import BRepPrimAPI_MakeBox, BRepPrimAPI_MakeCone, BRepPrimAPI_MakeCylinder, BRepPrimAPI_MakeSphere
from OCC.Core.gp import gp_Ax2, gp_Dir, gp_Pnt

from injection_molding.feature_extractor import InjectionMoldedFeatureExtractor
from injection_molding.recognition.core import recognize_core
from injection_molding.recognition.face_features import classify_faces
from injection_molding.recognition.feature_graph import RECOGNIZED, build_feature_graph
from injection_molding.recognition.holes import recognize_holes
from injection_molding.recognition.mesh import tessellate_faces
from shared.feature_vocabulary import feature_types, require_feature_type

Z = (0.0, 0.0, 1.0)
UNDRAFTED, MAX_DRAFT = 0.3, 5.0


def box(x, y, z, at=(0, 0, 0)):
    return BRepPrimAPI_MakeBox(gp_Pnt(*at), x, y, z).Shape()


def cyl(at, axis, radius, length):
    return BRepPrimAPI_MakeCylinder(gp_Ax2(gp_Pnt(*at), gp_Dir(*axis)), radius, length).Shape()


def cut(shape, *tools):
    for t in tools:
        shape = BRepAlgoAPI_Cut(shape, t).Shape()
    return shape


class TestFaceTypes:
    def test_a_box_is_all_planar_and_the_hole_wall_is_not_counted_twice(self):
        part = cut(box(100, 60, 10), cyl((50, 30, -1), Z, 5, 12))
        meshes = tessellate_faces(part, 0.05)
        holes = recognize_holes(meshes, Z)
        out = classify_faces(meshes, Z, skip_face_ids=[f for h in holes["holes"] for f in h["face_ids"]])
        assert out["PlanarFace"]["faces"] == 6
        assert out["CurvedWall"]["faces"] == 0 and out["CurvedSurface"]["faces"] == 0

    def test_a_cone_wall_is_a_curved_wall_and_its_flat_ends_are_planar(self):
        cone = BRepPrimAPI_MakeCone(gp_Ax2(gp_Pnt(0, 0, 0), gp_Dir(*Z)), 20.0, 17.0, 50.0).Shape()
        out = classify_faces(tessellate_faces(cone, 0.05), Z)
        assert out["CurvedWall"]["faces"] == 1
        assert out["PlanarFace"]["faces"] == 2

    def test_a_dome_facing_the_pull_is_a_curved_surface_not_a_wall(self):
        sphere = BRepPrimAPI_MakeSphere(gp_Pnt(0, 0, 0), 20.0).Shape()
        lower_half = box(60, 60, 30, at=(-30, -30, -30))
        dome = BRepAlgoAPI_Cut(sphere, lower_half).Shape()  # the upper cap plus its flat cut face
        out = classify_faces(tessellate_faces(dome, 0.05), Z)
        assert out["CurvedSurface"]["faces"] == 1
        assert out["CurvedWall"]["faces"] == 0

    def test_a_face_with_no_mesh_is_reported_unclassified_not_dropped(self):
        meshes = tessellate_faces(box(10, 10, 10), 0.05)
        empty = type(meshes[0])(index=99, surface="bspline", area=5.0, triangles=[])
        out = classify_faces(list(meshes) + [empty], Z)
        assert out["unclassified"]["face_ids"] == [99]


class TestFeatureGraph:
    def graph(self, part, **kw):
        return recognize_core(part, [100, 60, 20], UNDRAFTED, MAX_DRAFT, **kw)["feature_graph"]

    def test_holes_and_faces_become_typed_items_with_their_face_ids(self):
        part = cut(box(100, 60, 20), cyl((30, 30, -1), Z, 2.5, 22), cyl((70, 30, -1), Z, 2.5, 22), cyl((70, 30, 14), Z, 5, 8))
        g = self.graph(part)
        types = sorted((i["feature_type"], i["variant"]) for i in g["items"] if i["feature_type"].endswith("Hole"))
        assert types == [("MultiStepHole", "through"), ("SimpleHole", "through")]
        hole = next(i for i in g["items"] if i["feature_type"] == "SimpleHole")
        assert hole["diameter_mm"] == pytest.approx(5.0, abs=0.05)
        assert hole["occurrences"][0]["face_ids"]
        assert any(i["feature_type"] == "PlanarFace" for i in g["items"])
        assert g["schema"] == "plastic_feature_graph_v1"

    def test_every_type_not_yet_recognized_is_listed_so_none_found_is_never_assumed(self):
        g = self.graph(box(100, 60, 20))
        assert g["not_yet_recognized"] == ["ComboVoid", "LifterBundle", "PartingLine", "SharpEdge", "SlideBundle", "Void"]
        assert set(g["not_yet_recognized"]) | RECOGNIZED == set(feature_types("plastic_molding"))

    def test_the_vocabulary_gate_refuses_a_type_the_catalog_does_not_have(self):
        holes = {"holes": [{"id": "hole-1", "feature_type": "SimpleHoles", "variant": "through", "diameter_mm": 5.0, "depth_mm": 10.0, "depth_to_diameter": 2.0,
                            "angle_to_pull_deg": 0.0, "axis": [0, 0, 1], "steps": [], "face_ids": [1]}]}
        with pytest.raises(ValueError):
            build_feature_graph(holes, {}, [], 0.0, lambda t: require_feature_type("plastic_molding", t), sorted(feature_types("plastic_molding")))

    def test_legacy_ribs_are_carried_and_labelled_as_the_old_rule(self):
        g = self.graph(box(100, 60, 20), legacy_rib_groups=[{"thickness_mm": 1.5, "count": 4}], legacy_rib_confidence=0.55)
        rib = next(i for i in g["items"] if i["feature_type"] == "Rib")
        assert rib["variant"] == "legacy_antiparallel_pairs"
        assert rib["attributes"] == {"thickness_mm": 1.5, "count": 4, "confidence": 0.55}


def test_the_extractor_carries_the_graph_and_leaves_the_legacy_fields_as_they_were():
    part = cut(box(100, 60, 10), cyl((50, 30, -1), Z, 5, 12))
    out = InjectionMoldedFeatureExtractor().extract(part, [100.0, 60.0, 10.0])
    assert out["extraction_version"] == "im_v6_recognition_core"
    assert {"hole_or_boss_count", "through_hole_count", "undrafted_face_count", "rib_count", "parting_complexity", "feature_graph_v2"} <= set(out)
    rc = out["recognition_core"]
    assert rc["version"] == "plastic_recognition_core_v1"
    assert [i["feature_type"] for i in rc["feature_graph"]["items"] if i["feature_type"].endswith("Hole")] == ["SimpleHole"]
