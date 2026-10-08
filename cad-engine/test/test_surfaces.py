import pytest

pytest.importorskip("OCC")

from OCC.Core.BRepPrimAPI import BRepPrimAPI_MakeBox
from OCC.Core.BRepFilletAPI import BRepFilletAPI_MakeFillet
from OCC.Core.TopExp import TopExp_Explorer
from OCC.Core.TopAbs import TopAbs_EDGE
from OCC.Core.TopoDS import topods

from die_casting.features.surfaces import classify_surfaces


def test_filleted_box_fillet_face_is_curved_wall_not_dropped():
    box = BRepPrimAPI_MakeBox(50.0, 40.0, 20.0).Shape()
    # Fillet one vertical edge.
    maker = BRepFilletAPI_MakeFillet(box)
    exp = TopExp_Explorer(box, TopAbs_EDGE)
    edge = topods.Edge(exp.Current())
    maker.Add(5.0, edge)
    filleted = maker.Shape()

    result = classify_surfaces(filleted, claimed_face_ids=set())
    assert result["curved_wall_count"] >= 1
    assert result["sharp_edge_count"] >= 1
    # The fillet's own cylindrical face must be classified, never silently
    # dropped (no NotSupported bucket exists at this layer -- that is the
    # orchestrator's job over whatever remains globally unclaimed).
    total_classified = result["planar_face_count"] + result["curved_wall_count"] + result["curved_surface_count"]
    assert total_classified > 0
