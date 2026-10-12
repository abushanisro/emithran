"""
A bend's length is the face's own extent along its axis. Measuring it by
projecting the face's bounding box onto the axis overstates it whenever the
bend is tilted to the global axes: the same part, tilted, reported longer bends
(and let a 1.6 mm corner round on a tilted flange pass as an 8.8 mm bend, so the
quote counted 18 bends where the feature tree listed 17).

A real 90-degree bend (quarter of a thick tube: outer cylinder sector minus the
inner cylinder), then rotated about two global axes so its axis is parallel to
no bounding-box edge.
"""
import math

import pytest

pytest.importorskip("OCC")

from OCC.Core.BRepAlgoAPI import BRepAlgoAPI_Cut  # noqa: E402
from OCC.Core.BRepBuilderAPI import BRepBuilderAPI_Transform  # noqa: E402
from OCC.Core.BRepPrimAPI import BRepPrimAPI_MakeCylinder  # noqa: E402
from OCC.Core.gp import gp_Ax1, gp_Ax2, gp_Dir, gp_Pnt, gp_Trsf, gp_Vec  # noqa: E402

from sheet_metal.feature_extractor import SheetMetalFeatureExtractor  # noqa: E402

THICKNESS_MM = 2.0
INNER_RADIUS_MM = 3.0
WIDTH_MM = 50.0


def _quarter_tube_bend():
    """Axis along Z, so the sheet normal at the bend is any direction in the XY plane."""
    axes = gp_Ax2(gp_Pnt(0, 0, 0), gp_Dir(0, 0, 1))
    outer = BRepPrimAPI_MakeCylinder(axes, INNER_RADIUS_MM + THICKNESS_MM, WIDTH_MM, math.pi / 2).Shape()
    inner = BRepPrimAPI_MakeCylinder(axes, INNER_RADIUS_MM, WIDTH_MM).Shape()
    return BRepAlgoAPI_Cut(outer, inner).Shape()


def _tilted(shape, about_z_deg, about_x_deg):
    t1, t2 = gp_Trsf(), gp_Trsf()
    t1.SetRotation(gp_Ax1(gp_Pnt(0, 0, 0), gp_Dir(0, 0, 1)), math.radians(about_z_deg))
    t2.SetRotation(gp_Ax1(gp_Pnt(0, 0, 0), gp_Dir(1, 0, 0)), math.radians(about_x_deg))
    t2.Multiply(t1)
    normal = gp_Vec(1, 0, 0).Transformed(t2)  # perpendicular to the bend axis, as a sheet normal is
    return BRepBuilderAPI_Transform(shape, t2, True).Shape(), (normal.X(), normal.Y(), normal.Z())


@pytest.mark.parametrize("about_z, about_x", [(0.0, 0.0), (30.0, 25.0), (45.0, 60.0)])
def test_bend_line_length_is_the_sheet_width_however_the_part_is_oriented(about_z, about_x):
    tilted, normal = _tilted(_quarter_tube_bend(), about_z, about_x)

    bends = SheetMetalFeatureExtractor()._collect_dedup_bends(tilted, normal, THICKNESS_MM)

    assert len(bends) == 1
    assert bends[0]["radius"] == pytest.approx(INNER_RADIUS_MM, abs=0.01)
    assert bends[0]["axial_length"] == pytest.approx(WIDTH_MM, abs=0.01)
