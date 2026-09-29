"""
Real B-Rep tests for SheetMetalFeatureExtractor.formed_sheet_plane_excess --
the count behind memory_optimizer's sheet-metal connectivity veto.

A single bent sheet joins N distinct flat planes with at least N-1 bends, so
real sheet metal always has excess = planes - (bends + 1) <= 0. A machined body
whose thin walls happen to sit at one gauge (the reported 820-001644-00 TPH
holder: 8 planes, 2 bends, previously misclassified as perforated sheet) has
excess > 0: those walls cannot be folded out of one blank.

The fold count comes from bend FACES only; a shape with none returns None
(unknown) so the veto can never fire on it.
"""
import pytest

pytest.importorskip("OCC")

from OCC.Core.BRepAlgoAPI import BRepAlgoAPI_Fuse  # noqa: E402
from OCC.Core.BRepPrimAPI import BRepPrimAPI_MakeBox  # noqa: E402
from OCC.Core.gp import gp_Pnt  # noqa: E402
from OCC.Core.ShapeUpgrade import ShapeUpgrade_UnifySameDomain  # noqa: E402
from OCC.Core.Bnd import Bnd_Box  # noqa: E402
from OCC.Core.BRepBndLib import brepbndlib  # noqa: E402

from sheet_metal.feature_extractor import SheetMetalFeatureExtractor  # noqa: E402
from test_bend_relationships import THICKNESS_MM, WIDTH_MM, make_bent_sheet  # noqa: E402

WALL = 4.0


def _excess(shape):
    box = Bnd_Box()
    brepbndlib.Add(shape, box)
    x0, y0, z0, x1, y1, z1 = box.Get()
    extractor = SheetMetalFeatureExtractor()
    thickness, dominant_face, _conf, _dbg = extractor._extract_sheet_metal_geometry(
        shape, [x1 - x0, y1 - y0, z1 - z0],
    )
    return thickness, extractor.formed_sheet_plane_excess(
        shape, dominant_face, thickness, _raw_cylinders_full(shape),
    )


def _raw_cylinders_full(shape):
    """The same raw cylinder tuples production builds (reused from the
    end-to-end sheet-metal test's real-OCC face walk)."""
    from test_sheet_metal_feature_graph import _scan_cylinders_and_bbox
    return _scan_cylinders_and_bbox(shape)[0]


def _machined_comb(rib_count=4):
    """A solid base with `rib_count` parallel WALL-thick ribs standing on it --
    gauge-thick walls joined by solid material, with no bend faces at all."""
    shape = BRepPrimAPI_MakeBox(gp_Pnt(0, 0, 0), 80.0, 40.0, 10.0).Shape()
    for i in range(rib_count):
        x = 6.0 + i * 20.0
        rib = BRepPrimAPI_MakeBox(gp_Pnt(x, 0, 10.0), WALL, 40.0, 30.0).Shape()
        shape = BRepAlgoAPI_Fuse(shape, rib).Shape()
    return _unified(shape)


def _u_channel_with_ribs():
    """A real bent U-channel (2 radiused bends, 3 planes) with two gauge-thick
    ribs fused onto its base: two more wall planes, no more bends. Folding one
    blank can never produce those ribs -- the same situation as the machined
    820-001644-00 (8 planes, 2 bends)."""
    shape = make_bent_sheet(seg_lens=[30.0, 20.0, 30.0], angles_deg=[90.0, 90.0])
    half_w = WIDTH_MM / 2
    for x in (8.0, 18.0):
        rib = BRepPrimAPI_MakeBox(gp_Pnt(x, -half_w, THICKNESS_MM / 2), THICKNESS_MM, WIDTH_MM, 12.0).Shape()
        shape = BRepAlgoAPI_Fuse(shape, rib).Shape()
    return _unified(shape)


def _unified(shape):
    unify = ShapeUpgrade_UnifySameDomain(shape)
    unify.Build()
    return unify.Shape()


def test_real_bent_u_channel_is_consistent_with_one_sheet():
    _t, result = _excess(make_bent_sheet(seg_lens=[30.0, 20.0, 30.0], angles_deg=[90.0, 90.0]))
    assert result is not None
    assert result["bends"] == 2
    assert result["excess"] <= 0, result


def test_u_channel_with_fused_ribs_cannot_be_one_sheet():
    thickness, result = _excess(_u_channel_with_ribs())
    assert thickness == pytest.approx(THICKNESS_MM, abs=0.1)
    assert result is not None
    assert result["bends"] == 2
    assert result["excess"] > 0, result


def test_no_bend_faces_means_fold_count_is_unknown_not_zero():
    # Flat blanks and machined combs alike: with no bend faces the fold count
    # is not measurable, so the check reports unknown and can never veto.
    for shape in (BRepPrimAPI_MakeBox(gp_Pnt(0, 0, 0), 120.0, 60.0, 1.6).Shape(), _machined_comb(4)):
        _t, result = _excess(shape)
        assert result is None


def test_returns_none_without_a_sheet_frame_rather_than_guessing():
    assert SheetMetalFeatureExtractor().formed_sheet_plane_excess(None, None, 2.0) is None
