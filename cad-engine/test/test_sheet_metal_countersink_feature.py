"""
Countersunk holes reach feature_graph_v2 as SimpleHole/countersunk.

A real B-Rep plate (100 x 60 x 2 mm) with one 90-degree countersunk 6 mm hole and one
plain 6 mm hole, run through the FULL production extract() pipeline. The
countersink is the machining cone rule (a cone coaxial with a bore) already
used by the sheet-metal extractor for its countersink_count; it must now also
be a feature carrying the cone's own face ids, and the plain hole must not be.
"""
import pytest

pytest.importorskip("OCC")

from OCC.Core.BRepPrimAPI import BRepPrimAPI_MakeBox, BRepPrimAPI_MakeCylinder, BRepPrimAPI_MakeCone  # noqa: E402
from OCC.Core.BRepAlgoAPI import BRepAlgoAPI_Cut  # noqa: E402
from OCC.Core.gp import gp_Ax2, gp_Pnt, gp_Dir  # noqa: E402

from sheet_metal.feature_extractor import SheetMetalFeatureExtractor  # noqa: E402
from sheet_metal.feature_models import VARIANTS  # noqa: E402
from test_sheet_metal_feature_graph import _scan_cylinders_and_bbox  # noqa: E402

T = 2.0
HOLE_R = 3.0


def _plate(countersunk: bool):
    shape = BRepPrimAPI_MakeBox(100.0, 60.0, T).Shape()
    up = gp_Dir(0, 0, 1)
    for x in (30.0, 70.0):
        hole = BRepPrimAPI_MakeCylinder(gp_Ax2(gp_Pnt(x, 30.0, -1.0), up), HOLE_R, T + 2.0).Shape()
        shape = BRepAlgoAPI_Cut(shape, hole).Shape()
    if countersunk:
        # 90-degree countersink on the hole at x=30: radius grows 1 mm per mm,
        # from the hole wall at z=1 to 4.5 mm above the top face.
        cone = BRepPrimAPI_MakeCone(gp_Ax2(gp_Pnt(30.0, 30.0, 1.0), up), HOLE_R, HOLE_R + 1.5, 1.5).Shape()
        shape = BRepAlgoAPI_Cut(shape, cone).Shape()
    return shape


def _features(shape):
    raw_cylinders_full, bbox_minmax = _scan_cylinders_and_bbox(shape)
    result = SheetMetalFeatureExtractor().extract(
        shape,
        bbox_dims=[bbox_minmax["xmax"] - bbox_minmax["xmin"],
                   bbox_minmax["ymax"] - bbox_minmax["ymin"],
                   bbox_minmax["zmax"] - bbox_minmax["zmin"]],
        raw_cylinders_full=raw_cylinders_full,
        bbox_minmax=bbox_minmax,
    )
    return result, result["feature_graph_v2"]["features"]


def test_countersunk_hole_is_a_feature_with_the_cone_faces():
    result, features = _features(_plate(countersunk=True))
    countersunk = [f for f in features if f["feature_type"] == "SimpleHole" and f["variant"] == "countersunk"]
    assert "countersunk" in VARIANTS["SimpleHole"]
    assert len(countersunk) == 1
    occurrences = countersunk[0]["occurrences"]
    assert len(occurrences) == 1 == result["countersink_count"]
    assert occurrences[0]["face_ids"], "the countersink must carry its real cone face ids"
    assert occurrences[0]["entry_diameter_mm"] > 2 * HOLE_R


def test_plain_holes_have_no_countersunk_feature():
    _, features = _features(_plate(countersunk=False))
    assert not [f for f in features if f.get("variant") == "countersunk"]
