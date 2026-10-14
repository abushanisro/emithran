"""
The PMI graphics of a STEP (shared/step_pmi_graphics.py): curve sets and glyph triangles, read as geometry.

The statements are the real forms of RMP-00015's 'Width2@Width1(15)' callout, whose tolerance
("15.00 +/-0.25") exists only as drawn glyph triangles.
"""
import pytest

from shared.step_pmi_graphics import read_step_pmi_graphics

UNIT = "#1=(LENGTH_UNIT()NAMED_UNIT(*)SI_UNIT(.MILLI.,.METRE.));"
CALLOUT = [
    "#26=TESSELLATED_ANNOTATION_OCCURRENCE('Width2@Width1(15)',(#31),#27);",
    "#27=TESSELLATED_GEOMETRIC_SET('general dimension',(#32,#59));",
    "#32=TESSELLATED_CURVE_SET('',#33,((1,2,3,4)));",
    "#33=COORDINATES_LIST('',4,((-6.504476,7.5,-6.9),(-6.885476,11.056,-6.9),(-6.123476,11.056,-6.9),(-6.504476,7.5,-6.9)));",
    "#58=COORDINATES_LIST('',6,((0.,0.,-6.9),(1.,0.,-6.9),(1.,1.,-6.9),(0.,1.,-6.9),(2.,0.,-6.9),(2.,1.,-6.9)));",
    "#59=COMPLEX_TRIANGULATED_SURFACE_SET('',#58,6,((0.,0.,1.)),(),((1,2,3),(1,3,4)),((1,5,6,3)));",
]


def _text(*statements, unit=UNIT):
    flat = [x for group in statements for x in (group if isinstance(group, list) else [group])]
    return "ISO-10303-21;\nDATA;\n" + "\n".join([unit, *flat]) + "\nENDSEC;\n"


def test_a_callout_is_read_as_its_polylines_and_triangles():
    g = read_step_pmi_graphics(_text(CALLOUT))["graphics"]
    assert [c["callout"] for c in g] == ["Width2@Width1(15)"]
    assert g[0]["curves"] == [[[-6.504, 7.5, -6.9], [-6.885, 11.056, -6.9], [-6.123, 11.056, -6.9], [-6.504, 7.5, -6.9]]]


def test_strips_and_fans_become_triangles():
    tri = read_step_pmi_graphics(_text(CALLOUT))["graphics"][0]["triangles"]
    # two single-triangle strips + a fan of 4 indices (= 2 triangles) = 4 triangles = 36 numbers
    assert len(tri) == 4 * 9
    assert tri[:9] == [0.0, 0.0, -6.9, 1.0, 0.0, -6.9, 1.0, 1.0, -6.9]  # strip (1,2,3)


def test_a_file_that_is_not_in_millimetres_is_reported_not_scaled():
    inch = "#1=(CONVERSION_BASED_UNIT('INCH',#9)LENGTH_UNIT()NAMED_UNIT(*));"
    r = read_step_pmi_graphics(_text(CALLOUT, unit=inch))
    assert r["graphics"] == []
    assert "not millimetres" in r["unresolved"][0]


def test_a_file_with_no_annotation_graphics_is_empty():
    assert read_step_pmi_graphics("ISO-10303-21;\nDATA;\n#1=CARTESIAN_POINT('',(0.,0.,0.));\nENDSEC;\n") == {"graphics": [], "unresolved": []}


def test_an_out_of_range_index_is_reported_not_crashing():
    bad = [s.replace("((1,2,3,4))", "((1,2,3,99))") for s in CALLOUT]
    r = read_step_pmi_graphics(_text(bad))
    assert any("Width2@Width1(15)" in u for u in r["unresolved"])


def test_each_filled_set_is_reported_with_its_triangle_count_so_characters_can_be_cut_apart():
    g = read_step_pmi_graphics(_text(CALLOUT))["graphics"][0]
    assert g["glyph_triangle_counts"] == [4]  # one filled set: 2 strip triangles + a 4-index fan (2 triangles)
    assert sum(g["glyph_triangle_counts"]) * 9 == len(g["triangles"])
