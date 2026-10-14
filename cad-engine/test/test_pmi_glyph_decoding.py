"""
Decoding the text of RMP-00015's PMI graphics (shared/pmi_glyphs.py + the verified template library).

The graphics are the real filled glyph sets of its 20 callouts (test/fixtures/pmi/rmp15_graphics.json). The
templates were built from callouts whose text was verified by eye (scripts/pmi_glyph_manifest.json), so
the honest accuracy figures are the leave-one-out ones: each callout decoded with templates built WITHOUT it.
The safety property under test: a glyph is either read correctly or left '?', never read as the wrong character.
"""
import json
import math
import os

import pytest

from shared.pmi_glyph_library import build_templates, default_templates
from shared.pmi_glyphs import decode_callout

HERE = os.path.dirname(__file__)
GRAPHICS = json.load(open(os.path.join(HERE, "fixtures/pmi/rmp15_graphics.json"), encoding="utf8"))
MANIFEST = json.load(open(os.path.join(HERE, "..", "scripts/pmi_glyph_manifest.json"), encoding="utf8"))
BY_NAME = {g["callout"]: g for g in GRAPHICS}


def _decode(name, templates=None, graphic=None):
    g = graphic or BY_NAME[name]
    return decode_callout(g["triangles"], g["glyph_triangle_counts"], default_templates() if templates is None else templates)


def _text(d):
    return d["text"].replace(" ", "")


def test_the_library_reads_every_verified_callout_exactly():
    for name, truth in MANIFEST["callouts"].items():
        d = _decode(name)
        want = truth["text"].replace(" ", "")
        if truth.get("order") == "vertical":  # a datum symbol: arrow above letter, no reading order
            assert sorted(_text(d)) == sorted(want), name
        else:
            assert _text(d) == want, name
        assert d["resolved"], name


def test_leave_one_out_never_reads_a_wrong_character():
    correct = unresolved = wrong = 0
    for name, truth in MANIFEST["callouts"].items():
        if truth.get("order") == "vertical":
            continue
        d = _decode(name, build_templates(GRAPHICS, MANIFEST, exclude=[name]))
        want = [c for c in truth["text"] if c != " "]
        got = [c for c in d["text"] if c != " "]
        assert len(got) == len(want), name
        for w, r in zip(want, got):
            if r == w:
                correct += 1
            elif r == "?":
                unresolved += 1
            else:
                wrong += 1
    total = correct + unresolved + wrong
    assert wrong == 0
    assert correct / total >= 0.95  # measured 131 / 133


def test_a_reading_that_differs_when_turned_upside_down_is_never_resolved_to_the_wrong_one():
    """'6.00' turned 180 degrees reads '00.9': without a 6 template the decoder must not accept either as certain."""
    for name in ("DistanceBetween2@Plane13(6)", "DistanceBetween1@Cylinder13(6)"):
        d = _decode(name, build_templates(GRAPHICS, MANIFEST, exclude=[name, "DistanceBetween1@Cylinder13(6)", "DistanceBetween2@Plane13(6)"]))
        assert not (d["resolved"] and _text(d) == "00.9")


def test_held_out_frames_with_a_leader_dot_are_read_and_the_dot_is_set_aside():
    flat = _decode("Flatness2@Plane10")        # never used to build a template
    perp = _decode("Perpendicularity1@Plane11")
    assert (_text(flat), flat["resolved"], flat["ignored_glyphs"]) == ("0.25", True, 1)
    assert (_text(perp), perp["resolved"], perp["ignored_glyphs"]) == ("0.25A", True, 1)


def test_a_character_the_library_has_never_seen_is_unresolved_not_guessed():
    # the 'x' of "4 x R4.75" exists only in these two callouts
    templates = build_templates(GRAPHICS, MANIFEST, exclude=["Radius8@Cylinder Pattern1(4.75)", "Diameter4@Hole Pattern2(5.5)"])
    d = _decode("Radius8@Cylinder Pattern1(4.75)", templates)
    assert d["resolved"] is False
    assert "?" in d["text"] and "R4.75" in d["text"].replace(" ", "")


def test_without_templates_nothing_is_decoded():
    d = _decode("Width2@Width1(15)", {})
    assert d["resolved"] is False and set(d["text"].replace(" ", "")) == {"?"}


def test_a_blob_that_is_no_character_is_not_accepted():
    g = json.loads(json.dumps(BY_NAME["Width2@Width1(15)"]))
    # replace the third glyph (the decimal point) with a large flat blob
    counts = g["glyph_triangle_counts"]
    start = sum(counts[:2]) * 9
    xs = [g["triangles"][start + k] for k in range(0, 9, 3)]
    blob = []
    for tri in ((0, 0), (3, 0), (3, 3)), ((0, 0), (3, 3), (0, 3)):
        for dx, dy in tri:
            blob += [xs[0] + dx, g["triangles"][start + 1] + dy, g["triangles"][start + 2]]
    g["triangles"] = g["triangles"][:start] + blob + g["triangles"][start + counts[2] * 9:]
    g["glyph_triangle_counts"] = counts[:2] + [2] + counts[3:]
    d = _decode(None, graphic=g)
    assert d["resolved"] is False and "?" in d["text"]


def _transform(graphic, rotate_deg=0.0, tilt_deg=0.0, shift=(0.0, 0.0, 0.0), mirror=False):
    """The same drawn callout rotated in its plane, tilted out of it, moved, or seen from behind."""
    a, b = math.radians(rotate_deg), math.radians(tilt_deg)
    ca, sa, cb, sb = math.cos(a), math.sin(a), math.cos(b), math.sin(b)
    out = []
    t = graphic["triangles"]
    for i in range(0, len(t), 3):
        x, y, z = t[i], t[i + 1], t[i + 2]
        x, y = x * ca - y * sa, x * sa + y * ca          # about the (z) plane normal of this fixture
        y, z = y * cb - z * sb, y * sb + z * cb          # tilt the plane
        if mirror:
            z = -z
        out += [x + shift[0], y + shift[1], z + shift[2]]
    return {**graphic, "triangles": out}


@pytest.mark.parametrize("name,expected", [
    ("Width2@Width1(15)", "15.00±0.25"),
    ("Radius1@Cylinder2(45.75)", "R45.75±0.15"),
    ("Position1@Hole Pattern2", "0.15A-B-C"),
])
@pytest.mark.parametrize("rotate,tilt,mirror", [(37.0, 0.0, False), (0.0, 41.0, False), (123.0, 17.0, False), (0.0, 0.0, True)])
def test_the_same_callout_read_after_any_rigid_move_or_seen_from_behind(name, expected, rotate, tilt, mirror):
    d = _decode(None, graphic=_transform(BY_NAME[name], rotate, tilt, (500.0, -300.0, 70.0), mirror))
    assert _text(d) == expected and d["resolved"]
