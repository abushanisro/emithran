"""
AxiGroove (gear / spline teeth) recognition on real OCC solids.

The splined disc: a Ø10 × 3 mm cylinder with 12 Ø2 mm cylindrical teeth fused
round its rim (tooth axes on the Ø10 circle), deliberately placed away from
the global origin so nothing depends on the part sitting at 0,0,0.
Expected from the construction: 12 teeth, tip Ø12 (5 + 1 mm radius), root
Ø10 (the teeth meet the disc on the Ø10 circle), face width 3 mm.
"""
import math

import pytest

from OCC.Core.BRepAlgoAPI import BRepAlgoAPI_Fuse
from OCC.Core.BRepBuilderAPI import BRepBuilderAPI_Transform
from OCC.Core.BRepPrimAPI import BRepPrimAPI_MakeCylinder
from OCC.Core.ShapeUpgrade import ShapeUpgrade_UnifySameDomain
from OCC.Core.gp import gp_Ax2, gp_Dir, gp_Pnt, gp_Trsf, gp_Vec

from machining.machining_feature_recognizer import MachiningFeatureRecognizer

OFFSET = gp_Vec(30.0, 7.0, -4.0)


def _cylinder(x: float, y: float, radius: float, height: float):
    return BRepPrimAPI_MakeCylinder(gp_Ax2(gp_Pnt(x, y, 0.0), gp_Dir(0, 0, 1)), radius, height).Shape()


def _moved(shape):
    t = gp_Trsf()
    t.SetTranslation(OFFSET)
    return BRepBuilderAPI_Transform(shape, t, True).Shape()


def _splined_disc(teeth: int):
    part = _cylinder(0, 0, 5.0, 3.0)
    for i in range(teeth):
        a = 2 * math.pi * i / teeth
        part = BRepAlgoAPI_Fuse(part, _cylinder(5.0 * math.cos(a), 5.0 * math.sin(a), 1.0, 3.0)).Shape()
    unify = ShapeUpgrade_UnifySameDomain(part, True, True, False)
    unify.Build()
    return _moved(unify.Shape())


def _features(shape):
    return MachiningFeatureRecognizer().recognize(shape, "turned").to_dict()


def test_splined_disc_is_an_axigroove_with_its_real_tooth_geometry():
    tree = _features(_splined_disc(12))
    teeth = [f for f in tree["features"] if f["type"] == "AxiGroove"]
    assert len(teeth) == 1
    p = teeth[0]["params"]
    assert p["tooth_count"] == 12
    assert p["tip_diameter_mm"] == pytest.approx(12.0, abs=0.05)
    assert p["root_diameter_mm"] == pytest.approx(10.0, abs=0.05)
    assert p["face_width_mm"] == pytest.approx(3.0, abs=0.01)
    assert teeth[0]["face_ids"]


def test_tooth_faces_are_never_reported_as_turned_diameters():
    tree = _features(_splined_disc(12))
    rings = [f for f in tree["features"] if f["type"] == "Ring" and f["variant"] == "outer_diameter"]
    # Only the coaxial Ø10 disc remnant may be a turned diameter; the 12 Ø2
    # tooth faces sit off the axis and a lathe cannot turn them.
    assert all(f["params"]["diameter_mm"] == pytest.approx(10.0, abs=0.01) for f in rings)


def test_a_single_off_axis_boss_is_not_a_tooth_form():
    part = BRepAlgoAPI_Fuse(_cylinder(0, 0, 5.0, 3.0), _cylinder(5.0, 0.0, 1.0, 3.0)).Shape()
    tree = _features(_moved(part))
    assert not [f for f in tree["features"] if f["type"] == "AxiGroove"]
    assert any("no rotational tooth symmetry" in w for w in tree["warnings"])
