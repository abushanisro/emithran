"""additive.feature_extractor: build direction, overhang, supports and plate contact on OCC-built parts with hand-computed values."""
import pytest

pytest.importorskip("OCC")

from OCC.Core.BRepAlgoAPI import BRepAlgoAPI_Fuse  # noqa: E402
from OCC.Core.BRepPrimAPI import BRepPrimAPI_MakeBox  # noqa: E402
from OCC.Core.gp import gp_Pnt  # noqa: E402

from additive.feature_extractor import AdditiveFeatureExtractor, choose_direction, nearest_axis, orientation  # noqa: E402
from injection_molding.recognition.mesh import tessellate_faces  # noqa: E402


def box(x, y, z, at=(0.0, 0.0, 0.0)):
    return BRepPrimAPI_MakeBox(gp_Pnt(*at), x, y, z).Shape()


def fuse(a, b):
    return BRepAlgoAPI_Fuse(a, b).Shape()


def tee():
    """A 10 x 10 x 30 stem standing on z=0, with a 50 x 10 x 5 flange on top (z 30..35): 40 x 10 mm of flange hangs over at 30 mm."""
    return fuse(box(10, 10, 30, at=(20, 0, 0)), box(50, 10, 5, at=(0, 0, 30)))


def test_a_block_needs_no_support_and_stands_on_its_largest_face():
    out = AdditiveFeatureExtractor().extract(box(60, 40, 10), [60, 40, 10])
    assert out["overhang_area_mm2"] == pytest.approx(0.0, abs=1e-6)
    assert out["support_volume_mm3"] == pytest.approx(0.0, abs=1e-6)
    # Every direction is support-free: the lowest build is the 10 mm one, on the 60 x 40 face.
    assert out["build_height_mm"] == pytest.approx(10.0, abs=0.05)
    assert sorted(out["footprint_mm"]) == pytest.approx([40.0, 60.0], abs=0.05)
    assert out["plate_contact_area_mm2"] == pytest.approx(60 * 40, rel=1e-3)
    assert out["part_volume_mm3"] == pytest.approx(60 * 40 * 10, rel=1e-6)


def test_a_tee_built_upright_hangs_its_flange_over_the_plate():
    meshes = tessellate_faces(tee(), linear_deflection=0.05)
    up = orientation(meshes, (0.0, 0.0, 1.0), 0.1)["by_angle"]["45"]
    # The flange's underside beside the stem: (50 - 10) x 10 mm, 30 mm above the plate.
    assert up["overhang_area_mm2"] == pytest.approx(400.0, rel=1e-3)
    assert up["support_volume_mm3"] == pytest.approx(400.0 * 30.0, rel=1e-3)
    # The stem's foot on the plate plus the overhang seen from below.
    assert up["plate_contact_area_mm2"] == pytest.approx(100.0 + 400.0, rel=1e-3)
    # The stem splits the underside in two: 0..20 mm and 30..50 mm, each supported on its own.
    assert up["overhang_regions"] == 2


def test_the_tee_is_built_where_it_needs_the_least_support():
    out = AdditiveFeatureExtractor().extract(tee(), [50, 10, 35])
    # Upside down (flange on the plate, the stem rising from it), or on its side (the 10 mm face down): no overhang; of those the lowest.
    assert out["overhang_area_mm2"] == pytest.approx(0.0, abs=1e-6)
    assert out["build_direction"]["source"] == "least_support"
    assert out["build_height_mm"] == pytest.approx(10.0, abs=0.05)
    kinds = {f["feature_type"] for f in out["feature_graph_v2"]["features"]}
    assert "BuildDirection" in kinds and "SupportStructure" not in kinds


def test_a_steeper_self_supporting_angle_needs_no_less_support():
    meshes = tessellate_faces(tee(), linear_deflection=0.05)
    by = orientation(meshes, (0.0, 0.0, 1.0), 0.1)["by_angle"]
    assert by["30"]["overhang_area_mm2"] <= by["45"]["overhang_area_mm2"]


def test_the_engineers_direction_overrides_the_choice():
    out = AdditiveFeatureExtractor().extract(tee(), [50, 10, 35], build_direction_override=(0.0, 0.0, 0.9))
    assert out["build_direction"] == {"axis": "+z", "vector": [0.0, 0.0, 1.0], "source": "engineer", "self_supporting_deg": 45.0}
    assert out["support_volume_mm3"] == pytest.approx(12000.0, rel=1e-3)
    support = [f for f in out["feature_graph_v2"]["features"] if f["feature_type"] == "SupportStructure"]
    assert support and support[0]["occurrences"][0]["face_ids"]
    m = out["feature_graph_v2"]["measurements"]
    assert m["build_height"]["value"] == pytest.approx(35.0, abs=0.05)
    assert m["support_volume"]["occurrences"][0]["face_ids"] == support[0]["occurrences"][0]["face_ids"]


def test_choice_and_axis_helpers():
    assert nearest_axis((0.1, -0.9, 0.0)) == "-y"
    c = {"+z": {"build_height_mm": 30, "by_angle": {"45": {"overhang_area_mm2": 100.0}}},
         "-z": {"build_height_mm": 10, "by_angle": {"45": {"overhang_area_mm2": 101.0}}},
         "+x": {"build_height_mm": 5, "by_angle": {"45": {"overhang_area_mm2": 500.0}}}}
    # 100 and 101 are equal within 2 %: the lower build wins; 500 is not a candidate however low.
    assert choose_direction(c) == "-z"


def test_the_family_hint_measures_an_additive_part():
    from shared.memory_optimizer import AdvancedCADMemoryOptimizer
    from shared.part_family import ADDITIVE

    mi = AdvancedCADMemoryOptimizer().analyze_and_optimize(tee(), family_hint=ADDITIVE).geometry_features.manufacturing_features["manufacturing_intelligence"]
    assert mi["detected_family"] == ADDITIVE
    assert mi["features"]["extraction_version"] == "additive-2"
    assert mi["features"]["feature_graph_v2"]["measurements"]["build_height"]["value"] > 0
