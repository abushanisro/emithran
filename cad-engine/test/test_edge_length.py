"""
Sharp-edge length (shared/edge_length.py) on real OCC solids, with the
expected values worked out from the geometry by hand.
"""
import math

import pytest

from OCC.Core.BRepPrimAPI import BRepPrimAPI_MakeBox, BRepPrimAPI_MakeCylinder
from OCC.Core.BRepFilletAPI import BRepFilletAPI_MakeFillet
from OCC.Core.TopAbs import TopAbs_EDGE
from OCC.Core.TopExp import TopExp_Explorer
from OCC.Core.TopoDS import topods

from shared.edge_length import sharp_edge_length


def test_box_every_edge_is_sharp():
    # 12 edges: 4 each of 10, 20 and 30 mm.
    result = sharp_edge_length(BRepPrimAPI_MakeBox(10.0, 20.0, 30.0).Shape())
    assert result["sharp_edge_count"] == 12
    assert result["sharp_edge_length_mm"] == pytest.approx(4 * (10 + 20 + 30), abs=1e-3)


def test_cylinder_seam_is_not_an_edge():
    # Two circular rims (2π·5 each) are sharp; the side's seam line is not.
    result = sharp_edge_length(BRepPrimAPI_MakeCylinder(5.0, 20.0).Shape())
    assert result["sharp_edge_count"] == 2
    assert result["sharp_edge_length_mm"] == pytest.approx(2 * 2 * math.pi * 5.0, abs=1e-3)
    # The 20 mm seam is still a B-Rep edge, just not a deburr edge.
    assert result["total_edge_length_mm"] == pytest.approx(2 * 2 * math.pi * 5.0 + 20.0, abs=1e-3)


def test_fillet_removes_the_rounded_edge_and_adds_no_tangent_edges():
    box = BRepPrimAPI_MakeBox(10.0, 20.0, 30.0).Shape()
    first_edge = topods.Edge(TopExp_Explorer(box, TopAbs_EDGE).Current())
    fillet = BRepFilletAPI_MakeFillet(box)
    fillet.Add(2.0, first_edge)
    rounded = fillet.Shape()

    sharp_box = sharp_edge_length(box)
    sharp_rounded = sharp_edge_length(rounded)
    # The filleted edge is gone and the fillet meets both faces tangentially,
    # so it contributes no sharp edge of its own: one fewer sharp edge
    # along its length. The edges crossing the fillet ends stay sharp.
    assert sharp_rounded["sharp_edge_length_mm"] < sharp_box["sharp_edge_length_mm"]
    tangent_edges_excluded = sharp_rounded["total_edge_length_mm"] - sharp_rounded["sharp_edge_length_mm"]
    assert tangent_edges_excluded > 0
