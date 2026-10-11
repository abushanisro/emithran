"""
Cut length and its 3D highlight come from ONE walk (_compute_cut_length):
the cut_profile feature's occurrences carry exactly the side-wall faces of
the edges that were summed, per category, with that category's length.

Real B-Rep, the full production extract() pipeline:
  - a flat 100 x 50 x 2 mm plate with a 10 mm hole: outer = 300 mm,
    hole = 10*pi mm, highlighted faces = the 4 side walls and the hole wall
  - a two-bend U-channel: no bend (fold-transition) face is ever highlighted
    as a cut — the previous separate highlight walk included them
"""
import math

import pytest

pytest.importorskip("OCC")

from OCC.Core.BRepAlgoAPI import BRepAlgoAPI_Cut  # noqa: E402
from OCC.Core.BRepAdaptor import BRepAdaptor_Surface  # noqa: E402
from OCC.Core.BRepPrimAPI import BRepPrimAPI_MakeBox, BRepPrimAPI_MakeCylinder  # noqa: E402
from OCC.Core.GeomAbs import GeomAbs_Cylinder, GeomAbs_Plane  # noqa: E402
from OCC.Core.TopAbs import TopAbs_FACE  # noqa: E402
from OCC.Core.TopExp import TopExp_Explorer  # noqa: E402
from OCC.Core.TopoDS import topods  # noqa: E402
from OCC.Core.gp import gp_Ax2, gp_Dir, gp_Pnt  # noqa: E402

from sheet_metal.feature_extractor import SheetMetalFeatureExtractor  # noqa: E402
from test_bend_relationships import make_bent_sheet  # noqa: E402
from test_sheet_metal_feature_graph import _scan_cylinders_and_bbox  # noqa: E402


def _extract(shape):
    raw_cylinders_full, bbox = _scan_cylinders_and_bbox(shape)
    return SheetMetalFeatureExtractor().extract(
        shape,
        bbox_dims=[bbox["xmax"] - bbox["xmin"], bbox["ymax"] - bbox["ymin"], bbox["zmax"] - bbox["zmin"]],
        raw_cylinders_full=raw_cylinders_full,
        bbox_minmax=bbox,
    ), raw_cylinders_full


def _faces(shape):
    out = []
    exp = TopExp_Explorer(shape, TopAbs_FACE)
    while exp.More():
        out.append(topods.Face(exp.Current()))
        exp.Next()
    return out


def _cut_occurrences(result):
    fg = result["feature_graph_v2"]
    blanks = [f for f in fg["features"] if f["feature_type"] == "Blank" and f["id"] == "cut_profile"]
    assert len(blanks) == 1
    return {occ["cut_category"]: occ for occ in blanks[0]["occurrences"]}


def test_plate_with_hole_highlights_exactly_the_measured_cut():
    plate = BRepPrimAPI_MakeBox(100.0, 50.0, 2.0).Shape()
    hole = BRepPrimAPI_MakeCylinder(gp_Ax2(gp_Pnt(30.0, 25.0, -1.0), gp_Dir(0, 0, 1)), 5.0, 4.0).Shape()
    shape = BRepAlgoAPI_Cut(plate, hole).Shape()

    result, _ = _extract(shape)
    occ = _cut_occurrences(result)

    assert occ["outer_profile"]["length_mm"] == pytest.approx(300.0, abs=0.5)
    assert occ["circular_holes"]["length_mm"] == pytest.approx(10 * math.pi, abs=0.5)
    # Lengths on the highlight are the measured breakdown, not recomputed.
    breakdown = result["cut_length_breakdown"]
    assert occ["outer_profile"]["length_mm"] == breakdown["outer_profile_mm"]
    assert occ["circular_holes"]["length_mm"] == breakdown["circular_holes_mm"]

    faces = _faces(shape)
    outer = [BRepAdaptor_Surface(faces[i]).GetType() for i in occ["outer_profile"]["face_ids"]]
    holes = [BRepAdaptor_Surface(faces[i]).GetType() for i in occ["circular_holes"]["face_ids"]]
    assert outer == [GeomAbs_Plane] * 4, "the 4 side walls of the plate"
    assert holes == [GeomAbs_Cylinder], "the hole wall"
    assert "internal_profiles" not in occ


def test_u_channel_never_highlights_a_bend_as_a_cut():
    shape = make_bent_sheet(seg_lens=[30.0, 20.0, 30.0], angles_deg=[90.0, 90.0])
    result, raw_cylinders_full = _extract(shape)
    assert result["bend_count"] >= 2

    bend_face_ids = {int(c[8]) for c in raw_cylinders_full}  # this part's only cylinders are its bends
    occ = _cut_occurrences(result)
    highlighted = {fid for o in occ.values() for fid in o["face_ids"]}
    assert highlighted, "the channel's cut boundary is highlighted"
    assert highlighted.isdisjoint(bend_face_ids), "a fold transition is not a laser cut"
    assert occ["outer_profile"]["length_mm"] == result["cut_length_breakdown"]["outer_profile_mm"]
