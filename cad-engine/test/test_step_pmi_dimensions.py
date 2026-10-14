"""
Dimensions, datums and label-only callouts read from the STEP text (shared/step_pmi_dimensions.py).

The statements are the real entity forms of RMP-00015 (an AP242 export whose shape aspects carry no
model faces): the complex measure item, TOLERANCE_VALUE(lower, upper), the PMI-to-presentation link.
"""
import pytest

from shared.step_pmi_dimensions import read_step_dimensions

UNIT_MM = "#10=(LENGTH_UNIT()NAMED_UNIT(*)SI_UNIT(.MILLI.,.METRE.));"
UNIT_INCH = "#10=(CONVERSION_BASED_UNIT('INCH',#9)LENGTH_UNIT()NAMED_UNIT(*));"


def _dimension(first_id, kind, nominal, plus_minus=None, callout="Radius8@Cylinder Pattern1(4.75)", unit="#10", note=None):
    s = first_id
    out = [
        f"#{s}=COMPOSITE_SHAPE_ASPECT('','multiple elements',#1,.T.);",
        f"#{s+1}=DIMENSIONAL_SIZE(#{s},'{kind}');",
        f"#{s+2}=(LENGTH_MEASURE_WITH_UNIT()MEASURE_REPRESENTATION_ITEM()MEASURE_WITH_UNIT(POSITIVE_LENGTH_MEASURE({nominal}),{unit})QUALIFIED_REPRESENTATION_ITEM((#99))REPRESENTATION_ITEM('nominal'));",
    ]
    items = f"#{s+2}"
    if note:
        out.append(f"#{s+3}=DESCRIPTIVE_REPRESENTATION_ITEM('dimensional note','{note}');")
        items += f",#{s+3}"
    out += [
        f"#{s+4}=SHAPE_DIMENSION_REPRESENTATION('',({items}),#2);",
        f"#{s+5}=DIMENSIONAL_CHARACTERISTIC_REPRESENTATION(#{s+1},#{s+4});",
        f"#{s+6}=DRAUGHTING_CALLOUT('{callout}',(#99));",
        f"#{s+7}=DRAUGHTING_MODEL_ITEM_ASSOCIATION('PMI representation to presentation link','',#{s+1},#11,#{s+6});",
    ]
    if plus_minus:
        lo, hi = plus_minus
        out += [
            f"#{s+8}=LENGTH_MEASURE_WITH_UNIT(LENGTH_MEASURE({hi}),{unit});",
            f"#{s+9}=LENGTH_MEASURE_WITH_UNIT(LENGTH_MEASURE({lo}),{unit});",
            f"#{s+10}=TOLERANCE_VALUE(#{s+9},#{s+8});",
            f"#{s+11}=PLUS_MINUS_TOLERANCE(#{s+10},#{s+1});",
        ]
    return out


def _step(*statements, unit=UNIT_MM):
    body = "\n".join([unit, *[x for group in statements for x in group]])
    return f"ISO-10303-21;\nHEADER;\nENDSEC;\nDATA;\n{body}\nENDSEC;\nEND-ISO-10303-21;\n"


def test_radius_with_plus_minus_tolerance():
    r = read_step_dimensions(_step(_dimension(100, "radius", 4.75, (-0.15, 0.15))))
    assert r["dimensions"] == [{
        "callout": "Radius8@Cylinder Pattern1(4.75)", "kind": "radius", "nominal_mm": 4.75,
        "lower_mm": -0.15, "upper_mm": 0.15, "basic": False,
    }]
    assert r["unresolved"] == []


def test_asymmetric_bounds_are_kept_as_written():
    r = read_step_dimensions(_step(_dimension(100, "diameter", 40.08, (-0.05, 0.2), callout="Diameter5@Simple Hole7(40.08)")))
    d = r["dimensions"][0]
    assert (d["lower_mm"], d["upper_mm"]) == (-0.05, 0.2)


def test_a_dimension_with_no_tolerance_has_none_not_zero():
    d = read_step_dimensions(_step(_dimension(100, "diameter", 8.0)))["dimensions"][0]
    assert d["lower_mm"] is None and d["upper_mm"] is None


def test_a_theoretical_dimension_is_basic():
    d = read_step_dimensions(_step(_dimension(100, "curve length", 6, callout="DistanceBetween1@Cylinder13(6)", note="theoretical")))["dimensions"][0]
    assert d["basic"] is True and d["lower_mm"] is None


def test_inch_units_are_converted_to_mm():
    r = read_step_dimensions(_step(_dimension(100, "diameter", 1.0, (-0.01, 0.01)), unit=UNIT_INCH))
    d = r["dimensions"][0]
    assert d["nominal_mm"] == pytest.approx(25.4)
    assert d["upper_mm"] == pytest.approx(0.254)


def test_an_unresolvable_unit_is_reported_not_guessed():
    r = read_step_dimensions(_step(_dimension(100, "diameter", 5.0, (-0.1, 0.1)), unit="#10=(LENGTH_UNIT()NAMED_UNIT(*)SI_UNIT($,.PASCAL.));"))
    assert r["dimensions"] == []
    assert any("DIMENSIONAL_SIZE" in u for u in r["unresolved"])


def test_datum_letters_come_from_the_callout_label_only():
    callouts = [
        "#200=DRAUGHTING_CALLOUT('Datum443@Plane10(A)',(#99));",
        "#201=DRAUGHTING_CALLOUT('Datum451@Simple Hole1(C)',(#99));",
    ]
    r = read_step_dimensions(_step(callouts))
    assert [(d["letter"], d["feature"]) for d in r["datums"]] == [("A", "Plane10"), ("C", "Simple Hole1")]


def test_a_label_only_callout_is_presentation_only_with_no_tolerance():
    r = read_step_dimensions(_step(["#200=DRAUGHTING_CALLOUT('Width2@Width1(15)',(#99));"]))
    assert r["presentation_only"] == [{"callout": "Width2@Width1(15)", "kind": "width", "nominal_mm": 15.0}]
    assert r["dimensions"] == []


def test_a_labelled_callout_that_has_a_semantic_dimension_is_not_also_presentation_only():
    r = read_step_dimensions(_step(_dimension(100, "radius", 4.75, (-0.15, 0.15))))
    assert r["presentation_only"] == []


def test_a_file_with_no_pmi_reads_as_empty():
    r = read_step_dimensions("ISO-10303-21;\nDATA;\n#1=CARTESIAN_POINT('',(0.,0.,0.));\nENDSEC;\n")
    assert r == {"dimensions": [], "datums": [], "presentation_only": [], "unresolved": []}


# ── pmi.items[]: one record per PMI item ─────────────────────────────────────

from shared.step_pmi_dimensions import build_pmi_items, cad_feature_of


@pytest.mark.parametrize("label,feature", [
    ("Radius8@Cylinder Pattern1(4.75)", "Cylinder Pattern1"),
    ("Diameter5@Simple Hole7(40.08)-2", "Simple Hole7"),
    ("Datum451@Simple Hole1(C)", "Simple Hole1"),
    ("Position2@Simple Hole8", "Simple Hole8"),
    ("Width2@Width1(15)", "Width1"),
    ("no at sign", None),
    (None, None),
])
def test_the_cad_feature_a_label_names(label, feature):
    assert cad_feature_of(label) == feature


def test_every_pmi_item_becomes_one_normalized_record():
    extra = read_step_dimensions(_step(
        _dimension(100, "radius", 4.75, (-0.15, 0.15)),
        ["#200=DRAUGHTING_CALLOUT('Datum443@Plane10(A)',(#99));", "#201=DRAUGHTING_CALLOUT('Width2@Width1(15)',(#99));"],
    ))
    gdt = [{"type": "position", "tolerance": 0.15, "face_ids": [], "name": "Position1@Hole Pattern2"}]
    items = build_pmi_items(gdt, extra)
    assert sorted(i["kind"] for i in items) == ["datum", "dimension", "geometric", "label_only"]
    dim = next(i for i in items if i["kind"] == "dimension")
    assert (dim["cad_feature"], dim["nominal_mm"], dim["lower_mm"], dim["upper_mm"]) == ("Cylinder Pattern1", 4.75, -0.15, 0.15)
    geo = next(i for i in items if i["kind"] == "geometric")
    assert (geo["type"], geo["zone_mm"], geo["cad_feature"]) == ("position", 0.15, "Hole Pattern2")
    assert next(i for i in items if i["kind"] == "datum")["letter"] == "A"
    assert next(i for i in items if i["kind"] == "label_only")["nominal_mm"] == 15.0
    assert len({i["id"] for i in items}) == len(items)


def test_a_geometric_tolerance_never_carries_datum_references_the_file_does_not_store():
    items = build_pmi_items([{"type": "position", "tolerance": 0.05, "face_ids": [], "name": "Position2@Simple Hole8"}],
                            {"dimensions": [], "datums": [], "presentation_only": []})
    assert items[0]["datum_refs"] == []
