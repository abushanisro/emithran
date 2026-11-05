"""
Voids, combo voids, slide and lifter bundles and the parting line, on synthetic parts whose answers are known, plus the staged rules file against its source.

Run: docker compose -f docker-compose.dev.yml --profile test run --rm tests pytest test/test_plastic_side_actions.py
"""
import json
import math
from pathlib import Path

import pytest
from OCC.Core.BRepAlgoAPI import BRepAlgoAPI_Cut
from OCC.Core.BRepBuilderAPI import BRepBuilderAPI_Transform
from OCC.Core.BRepPrimAPI import BRepPrimAPI_MakeBox, BRepPrimAPI_MakeCone, BRepPrimAPI_MakeCylinder
from OCC.Core.gp import gp_Ax1, gp_Ax2, gp_Dir, gp_Pnt, gp_Trsf

from injection_molding.recognition.core import recognize_core
from injection_molding.recognition.rules import staged_rules

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


def core(part, dims=(100, 60, 20)):
    return recognize_core(part, list(dims), UNDRAFTED, MAX_DRAFT, pull_override=Z)


def side_pocket(y0, y1=None, x0=50.0):
    """A pocket cut into the +x face under an overhang (z 5..15 of a 20 mm block): the main halves cannot form it."""
    return box(100.0 - x0 + 1, (y1 or y0 + 10) - y0, 10, at=(x0, y0, 5))


class TestVoids:
    def test_a_pocket_under_an_overhang_is_one_void_opening_along_x(self):
        out = core(cut(box(100, 60, 20), side_pocket(10, 30)))
        voids = out["side_actions"]["voids"]
        assert len(voids) == 1
        v = voids[0]
        assert v["accessible_direction"] == pytest.approx([1.0, 0.0, 0.0], abs=0.01)
        assert v["angle_to_pull_deg"] == pytest.approx(90.0, abs=0.5)
        assert v["depth_mm"] == pytest.approx(50.0, abs=0.5)  # the pocket is cut from x=50 to the face at x=100
        assert v["equivalent_diameter_mm"] > 10
        item = next(i for i in out["feature_graph"]["items"] if i["feature_type"] == "Void")
        assert item["attributes"]["reading"] == "side_action_reading_v1"
        assert item["occurrences"][0]["face_ids"] == v["face_ids"]

    def test_every_occurrence_carries_a_part_centred_centroid_for_the_viewer(self):
        items = core(cut(box(100, 60, 20), side_pocket(10, 30)))["feature_graph"]["items"]
        void = next(i for i in items if i["feature_type"] == "Void")
        cx, cy, cz = void["occurrences"][0]["centroid"]
        # the pocket is on the +x side of the block (x 50..100), y 10..30, z 5..15; the block's centre is (50, 30, 10)
        assert cx > 0 and cy < 0 and abs(cz) < 6
        assert all("centroid" in o for i in items for o in i["occurrences"])

    def test_a_pocket_the_halves_can_form_is_not_a_void(self):
        out = core(cut(box(100, 60, 20), box(30, 20, 10, at=(20, 20, 10))))  # open to +z: formed by the mold half
        assert out["side_actions"]["voids"] == []

    def test_a_plain_plate_with_holes_along_the_pull_has_no_side_actions(self):
        out = core(cut(box(100, 60, 20), cyl((30, 30, -1), Z, 3, 22), cyl((70, 30, -1), Z, 3, 22)))
        sa = out["side_actions"]
        assert sa["voids"] == [] and sa["combo_voids"] == [] and sa["bundles"] == []


class TestBundles:
    def test_two_close_side_pockets_on_one_axis_share_one_slide_bundle(self):
        part = cut(box(100, 60, 20), side_pocket(5, 15), side_pocket(25, 35))
        sa = core(part)["side_actions"]
        assert len(sa["voids"]) == 2
        assert len(sa["bundles"]) == 1
        b = sa["bundles"][0]
        assert b["count"] == 2 and b["feature_type"] in ("SlideBundle", "LifterBundle")
        assert b["width_mm"] == pytest.approx(30.0, abs=1.0)  # across the parting plane: y 5..35
        assert b["slide_alternative"] is True  # square to the pull, so a lifter could serve it and so could a slide: not decided here
        assert b["size_class"] == "small"  # 30 mm is under the 76.2 mm threshold

    def test_pockets_further_apart_than_the_pitch_are_separate_bundles(self):
        gap = staged_rules()["maxGCDPitch"]
        far = 5 + 10 + gap + 5
        part = cut(box(100, far + 20, 20), side_pocket(5, 15), side_pocket(far, far + 10))
        sa = core(part, (100, far + 20, 20))["side_actions"]
        assert len(sa["voids"]) == 2 and len(sa["bundles"]) == 2

    def test_an_oblique_hole_is_reported_unbundled_not_forced_into_a_bundle(self):
        axis = (math.cos(math.radians(50)), 0.0, math.sin(math.radians(50)))  # 50 deg from the pull: outside both epsilons
        part = cut(box(100, 60, 20), cyl((50 - 20 * axis[0], 30, 10 - 20 * axis[2]), axis, 2.0, 60))
        sa = core(part)["side_actions"]
        assert sa["bundles"] == []
        assert [u["kind"] for u in sa["unbundled_oblique"]] == ["hole"]


class TestComboVoid:
    def test_a_side_pocket_with_a_side_hole_beside_it_is_one_combo_replacing_both(self):
        # the hole runs along x through the wall beside the pocket, within the pitch
        part = cut(box(100, 60, 20), side_pocket(10, 20), cyl((50, 35, 10), (1, 0, 0), 2.0, 60))
        out = core(part)
        sa = out["side_actions"]
        assert len(sa["combo_voids"]) == 1
        assert len(sa["combo_voids"][0]["member_ids"]) == 2
        graph_types = [i["feature_type"] for i in out["feature_graph"]["items"]]
        assert graph_types.count("ComboVoid") == 1
        assert "Void" not in graph_types  # the members are replaced by the combo, not counted twice
        assert not [i for i in out["feature_graph"]["items"] if i["feature_type"] == "SimpleHole"]


class TestPartingLine:
    def test_a_cone_has_a_flat_parting_line_the_length_of_its_base_circle(self):
        cone = BRepPrimAPI_MakeCone(gp_Ax2(gp_Pnt(0, 0, 0), gp_Dir(*Z)), 20.0, 17.0, 50.0).Shape()
        out = recognize_core(cone, [40, 40, 50], UNDRAFTED, MAX_DRAFT, pull_override=Z)["parting_line"]
        assert out["status"] == "found" and out["variant"] == "flat"
        assert out["length_mm"] == pytest.approx(2 * math.pi * 20.0, rel=0.06)

    def test_a_tilted_block_has_a_non_flat_parting_line(self):
        t = gp_Trsf()
        t.SetRotation(gp_Ax1(gp_Pnt(50, 30, 10), gp_Dir(1, 0, 0)), math.radians(20))
        part = BRepBuilderAPI_Transform(box(100, 60, 20), t, True).Shape()
        out = recognize_core(part, [100, 60, 40], UNDRAFTED, MAX_DRAFT, pull_override=Z)["parting_line"]
        assert out["status"] == "found" and out["variant"] == "non_flat"

    def test_walls_along_the_pull_give_no_parting_line_and_say_why(self):
        out = core(box(100, 60, 20))["parting_line"]
        assert out["status"] == "indeterminate" and "no draft" in out["reason"]


def test_a_part_with_through_holes_counts_them_as_internal_cutouts_on_its_parting_line():
    cone = BRepPrimAPI_MakeCone(gp_Ax2(gp_Pnt(0, 0, 0), gp_Dir(*Z)), 20.0, 17.0, 50.0).Shape()
    part = cut(cone, cyl((0, 0, -1), Z, 3, 52))
    assert recognize_core(part, [40, 40, 50], UNDRAFTED, MAX_DRAFT, pull_override=Z)["parting_line"]["internal_cutouts"] == 1


def test_the_staged_rules_file_matches_its_source_when_the_licensed_data_is_present():
    source = Path(__file__).resolve().parents[2] / "memory" / "Plastic Modeling" / "variables" / "digital_factory_variables.csv"
    if not source.exists():
        pytest.skip("memory/ is licensed data and is not in this checkout")
    import csv

    rows = {r["variableName"]: float(r["stringValue"]) for r in csv.DictReader(source.open(newline="", encoding="utf-8"))}
    rules = staged_rules()
    assert rules and all(rows[k] == v for k, v in rules.items())
    assert set(json.loads((Path(__file__).resolve().parents[1] / "shared" / "plastic_recognition_rules.json").read_text())["rules"]) == set(rules)
