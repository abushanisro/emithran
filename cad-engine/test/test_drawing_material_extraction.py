"""
Material extraction in the drawing analyzer (text only, no PDF/OCR needed).

Regression for a real, confirmed-live bug: a title block whose material cell
is labelled "MATERIAL SPECIFICATION" (not just "MATERIAL") has no exact-match
label pattern to recognize it, so the spatial pass (path 1) found nothing and
the flat-text fallback (path 2) matched the bare word "MATERIAL" and captured
its own label's trailing word "SPECIFICATION" as if it were the material
value -- logged live as `material=SPECIFICATION(0.85)`. Fabricated label text
standing in for a real material grade, not a mock/hardcoded engine default.
"""
from shared.drawing_analyzer import _extract_material, _is_label, _is_placeholder


def test_material_specification_label_is_never_returned_as_a_material():
    # No title-block pair resolved (path 1 found nothing -- the real bug
    # scenario), and the flat text has nothing but the label's own wording,
    # no real value anywhere. Must disclose "Not specified", not fabricate
    # the label text as the material.
    flat = "MATERIAL SPECIFICATION\nSEE DRAWING NOTES FOR FULL CALLOUT"
    material, confidence = _extract_material({}, flat)
    assert material == "Not specified"
    assert confidence == 0.0


def test_material_specification_recognized_as_a_label_not_a_value():
    assert _is_label("MATERIAL SPECIFICATION") is True
    assert _is_label("MATERIAL") is True
    assert _is_placeholder("SPECIFICATION") is True
    assert _is_placeholder("SPEC") is True


def test_real_material_value_still_extracted_from_title_block_pass():
    # Path 1: a real spatially-resolved title-block pair must still win,
    # confirming the new label pattern didn't regress the happy path.
    tb = {"material": "6061-T6"}
    material, confidence = _extract_material(tb, "")
    assert material == "AA6061-T6"
    assert confidence == 0.92


def test_real_inline_material_still_extracted_from_flat_text():
    # Path 2: a genuine "MATERIAL: <value>" inline callout (not just the bare
    # label) must still be found -- the _is_label guard must not reject real
    # material designations.
    flat = "TITLE BLOCK\nMATERIAL: STAINLESS 304\nREV A"
    material, confidence = _extract_material({}, flat)
    assert material == "SS304"
    assert confidence == 0.85
