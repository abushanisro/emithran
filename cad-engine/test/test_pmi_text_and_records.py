"""
Typed values from decoded text (shared/pmi_text.py) and the engineering records built from RMP-00015's PMI
(shared/pmi_records.py): native values are authoritative, decoded values are flagged and never
automation-ready, a native/decoded disagreement is a conflict, and an unreadable callout stays unresolved.
"""
import copy
import json
import os

import pytest

from shared.pmi_records import build_pmi_records, engine_features
from shared.pmi_text import parse_datum_text, parse_dimension_text, parse_frame_text

HERE = os.path.dirname(__file__)
GRAPHICS = json.load(open(os.path.join(HERE, "fixtures/pmi/rmp15_graphics.json"), encoding="utf8"))
ITEMS = json.load(open(os.path.join(HERE, "fixtures/pmi/rmp15_items.json"), encoding="utf8"))["items"]
FEATURES = engine_features(json.load(open(os.path.join(HERE, "fixtures/pmi/rmp15_features.json"), encoding="utf8")))
PMI = {"items": ITEMS, "graphics": GRAPHICS}


def _records(pmi=None, **kw):
    out = build_pmi_records(copy.deepcopy(pmi or PMI), FEATURES, **kw)["records"]
    return {r["annotation_ref"]: r for r in out}


# ── text ─────────────────────────────────────────────────────────────────────

@pytest.mark.parametrize("text,expected", [
    ("15.00±0.25", dict(nominal=15.0, tolerance=0.25, prefix=None, count=1)),
    ("R45.75 ±0.15", dict(nominal=45.75, tolerance=0.15, prefix="R", count=1)),
    ("4 x R4.75 ±0.15", dict(nominal=4.75, tolerance=0.15, prefix="R", count=4)),
    ("4 x 5.50±0.15", dict(nominal=5.5, tolerance=0.15, prefix=None, count=4)),
    ("15,04 ±0,1", dict(nominal=15.04, tolerance=0.1, prefix=None, count=1)),   # decimal comma
    ("6.00", dict(nominal=6.0, tolerance=None, prefix=None, count=1)),
    ("Ø26.50±0.25", dict(nominal=26.5, tolerance=0.25, prefix="Ø", count=1)),
])
def test_dimension_text_is_parsed_to_typed_values(text, expected):
    p = parse_dimension_text(text)
    assert p["ok"] and all(p[k] == v for k, v in expected.items())


@pytest.mark.parametrize("text", ["15.0?±0.25", "R45.75 +0.2/-0.1", "H7", "45°", "15..0", "±0.25", ""])
def test_a_text_that_is_not_fully_understood_is_refused_with_a_reason(text):
    p = parse_dimension_text(text)
    assert p["ok"] is False and p["reason"]


def test_frame_and_datum_text():
    assert parse_frame_text("0.15 A-B-C") == {"ok": True, "zone": 0.15, "datum_refs": ["A", "B", "C"]}
    assert parse_frame_text(".05 A-B-C")["zone"] == 0.05
    assert parse_frame_text("0.015") == {"ok": True, "zone": 0.015, "datum_refs": []}
    assert parse_frame_text("0.2? A")["ok"] is False
    assert parse_datum_text("▼A") == "A" and parse_datum_text("A▼") == "A"
    assert parse_datum_text("▼?") is None and parse_datum_text("AB") is None


# ── records: the slot ────────────────────────────────────────────────────────

def test_the_slot_width_callout_becomes_a_typed_record_with_limits():
    r = _records()["Width2@Width1(15)"]
    assert (r["record_type"], r["dimension_type"]) == ("dimension", "width")
    assert r["nominal"] == {"value": 15.0, "unit": "mm"}
    assert r["tolerance"] == {"lower_mm": -0.25, "upper_mm": 0.25, "min_mm": 14.75, "max_mm": 15.25}
    assert r["source"] == "decoded_graphics"
    assert r["validation"]["status"] == "decoded_cross_checked"
    assert r["validation"]["automation_ready"] is False and r["validation"]["requires_review"] is True
    assert r["provenance"]["decode"]["text"].replace(" ", "") == "15.00±0.25"
    assert r["annotation_ref"] == "Width2@Width1(15)"


def test_the_slot_record_is_tied_to_the_engines_slot_feature():
    ref = _records()["Width2@Width1(15)"]["feature_ref"]
    assert ref["engine_feature_ids"] == ["slot_1"] and ref["face_ids"]
    assert "kind and size" in ref["association"]


def test_the_other_width_has_limits_but_matches_no_feature():
    r = _records()["Width4@Width3(15.04)"]
    assert (r["tolerance"]["min_mm"], r["tolerance"]["max_mm"]) == (14.94, 15.14)
    assert r["feature_ref"]["engine_feature_ids"] == []


# ── records: native values are authoritative ─────────────────────────────────

def test_native_dimensions_are_verified_and_their_drawn_text_agrees():
    recs = _records()
    for name in ("Radius1@Cylinder2(45.75)", "Radius8@Cylinder Pattern1(4.75)", "Diameter5@Simple Hole7(40.08)",
                 "Diameter3@Simple Hole1(26.5)", "Diameter4@Hole Pattern2(5.5)", "Radius5@Cylinder3(28.5)", "Radius6@Cylinder4(22.54)"):
        r = recs[name]
        assert r["source"] == "native_pmi", name
        assert r["validation"]["status"] == "verified" and r["validation"]["automation_ready"] is True, name
        assert "drawn text agrees with the native values" in r["validation"]["checks"], name
    r = recs["Radius1@Cylinder2(45.75)"]
    assert r["tolerance"] == {"lower_mm": -0.15, "upper_mm": 0.15, "min_mm": 45.6, "max_mm": 45.9}
    assert r["feature_ref"]["engine_feature_ids"] == ["arc_6"]


def test_a_basic_dimension_has_no_tolerance():
    r = _records()["DistanceBetween1@Cylinder13(6)"]
    assert r["basic"] is True and r["tolerance"] is None


def test_native_and_drawn_values_that_disagree_are_a_conflict_not_resolved_silently():
    pmi = copy.deepcopy(PMI)
    for it in pmi["items"]:
        if it.get("label") == "Radius1@Cylinder2(45.75)":
            it["lower_mm"], it["upper_mm"] = -0.5, 0.5  # the file's data says +/-0.5, its drawing says +/-0.15
    r = _records(pmi)["Radius1@Cylinder2(45.75)"]
    assert r["validation"]["status"] == "conflict"
    assert r["validation"]["automation_ready"] is False
    assert r["tolerance"]["upper_mm"] == 0.5  # the native value is kept, flagged, not overwritten
    assert any("disagrees" in x for x in r["validation"]["reasons"])


# ── records: GD&T ────────────────────────────────────────────────────────────

def test_a_native_position_tolerance_takes_its_datum_references_from_the_drawing_flagged():
    r = _records()["Position1@Hole Pattern2"]
    assert (r["record_type"], r["characteristic"], r["zone"]["value"]) == ("gdt", "position", 0.15)
    assert r["validation"]["status"] == "verified" and r["validation"]["applies_to"] == ["zone"]
    assert r["datum_refs"] == ["A", "B", "C"] and r["datum_refs_source"] == "decoded_graphics"
    assert r["datum_refs_validation"]["automation_ready"] is False
    assert r["feature_ref"]["engine_feature_ids"] == ["bore_3", "bore_4", "bore_9", "bore_10"] or len(r["feature_ref"]["engine_feature_ids"]) == 4


def test_a_frame_with_no_tolerance_entity_is_decoded_and_never_verified():
    r = _records()["Perpendicularity1@Plane11"]
    assert (r["characteristic"], r["characteristic_source"]) == ("perpendicularity", "callout label")
    assert (r["zone"]["value"], r["datum_refs"]) == (0.25, ["A"])
    assert r["validation"]["status"] == "decoded_unverified" and r["validation"]["automation_ready"] is False


def test_datum_letters_are_cross_checked_between_label_and_drawing():
    r = _records()["Datum451@Simple Hole1(C)"]
    assert (r["letter"], r["validation"]["status"]) == ("C", "decoded_cross_checked")
    assert r["feature_ref"]["engine_feature_ids"] == ["bore_2"]  # datum C is the Ø26.5 hole


# ── records: nothing decodable ───────────────────────────────────────────────

def test_without_glyph_decoding_native_values_stay_verified_and_label_only_ones_are_unresolved():
    recs = _records(decode=False)
    assert recs["Radius1@Cylinder2(45.75)"]["validation"]["status"] == "verified"
    w = recs["Width2@Width1(15)"]
    assert w["validation"]["status"] == "unresolved" and w["tolerance"] is None and w["validation"]["automation_ready"] is False
    assert "original graphics" in " ".join(w["validation"]["reasons"])


def test_unreadable_glyphs_leave_the_callout_unresolved_with_the_original_graphics_as_the_only_source():
    recs = _records(templates={"1": []})  # a library that knows nothing
    assert recs["Width2@Width1(15)"]["validation"]["status"] == "unresolved"
    assert recs["Perpendicularity1@Plane11"]["validation"]["status"] == "unresolved"
    assert recs["Radius1@Cylinder2(45.75)"]["validation"]["status"] == "verified"  # native does not need the drawing


def test_only_verified_native_values_are_automation_ready():
    recs = build_pmi_records(copy.deepcopy(PMI), FEATURES)["records"]
    for r in recs:
        if r["validation"]["automation_ready"]:
            assert r["source"] == "native_pmi" and r["validation"]["status"] == "verified"
    for r in recs:
        if r["source"] != "native_pmi":
            assert r["validation"]["automation_ready"] is False
    assert any(r["validation"]["automation_ready"] for r in recs)


def test_every_record_names_its_original_annotation_and_every_tolerance_has_consistent_limits():
    for r in build_pmi_records(copy.deepcopy(PMI), FEATURES)["records"]:
        assert r["annotation_ref"] and r["id"] == f"pmi:{r['annotation_ref']}"
        tol = r.get("tolerance")
        if tol:
            assert tol["min_mm"] == pytest.approx(r["nominal"]["value"] + tol["lower_mm"], abs=1e-6)
            assert tol["max_mm"] == pytest.approx(r["nominal"]["value"] + tol["upper_mm"], abs=1e-6)
            assert tol["min_mm"] < tol["max_mm"]


# ── fingerprints: what an approval is bound to ───────────────────────────────

from shared.pmi_records import datum_refs_fingerprint, record_fingerprint


def test_every_record_has_a_stable_content_fingerprint():
    a = build_pmi_records(copy.deepcopy(PMI), FEATURES)["records"]
    b = build_pmi_records(copy.deepcopy(PMI), FEATURES)["records"]
    assert [r["fingerprint"] for r in a] == [r["fingerprint"] for r in b]  # deterministic
    assert all(len(r["fingerprint"]) == 64 for r in a)
    assert len({r["fingerprint"] for r in a}) == len(a)  # distinct annotations never collide


def test_the_fingerprint_changes_when_anything_an_approval_depends_on_changes():
    rec = _records()["Width2@Width1(15)"]
    base = record_fingerprint(rec)
    for mutate in (
        lambda r: r["nominal"].__setitem__("value", 15.5),
        lambda r: r["tolerance"].__setitem__("upper_mm", 0.3),
        lambda r: r["feature_ref"].__setitem__("face_ids", r["feature_ref"]["face_ids"] + [1]),
        lambda r: r["provenance"]["decode"].__setitem__("text", "15.00 ±0.35"),
        lambda r: r.__setitem__("source", "native_pmi"),
    ):
        changed = copy.deepcopy(rec)
        mutate(changed)
        assert record_fingerprint(changed) != base


def test_the_fingerprint_ignores_things_that_are_not_content():
    rec = _records()["Width2@Width1(15)"]
    other = copy.deepcopy(rec)
    other["validation"]["reasons"].append("an extra explanatory note")
    other["id"] = "pmi:renamed"
    assert record_fingerprint(other) == record_fingerprint(rec)


def test_datum_references_are_a_separate_reviewable_claim_with_their_own_fingerprint():
    rec = _records()["Position1@Hole Pattern2"]
    assert rec["datum_refs_fingerprint"] == datum_refs_fingerprint(rec)
    changed = copy.deepcopy(rec)
    changed["datum_refs"] = ["A", "B"]
    assert datum_refs_fingerprint(changed) != rec["datum_refs_fingerprint"]
    assert "datum_refs_fingerprint" not in _records()["Width2@Width1(15)"]
