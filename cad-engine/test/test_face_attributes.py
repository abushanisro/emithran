"""
shared/face_attributes.py on real B-Rep: per-face attributes and edge convexity.

  - box: 6 planes, 12 edges, every one convex at 90 degrees
  - box with a rectangular pocket: its 8 inside edges (4 wall-to-floor, 4
    corner) are concave, the 12 box edges + 4 rim edges are convex
  - box with one filleted edge: the two fillet-to-face edges are smooth
  - cylinder: the seam is omitted; both rim circles are convex
"""
import pytest

pytest.importorskip("OCC")

from OCC.Core.BRepAlgoAPI import BRepAlgoAPI_Cut  # noqa: E402
from OCC.Core.BRepFilletAPI import BRepFilletAPI_MakeFillet  # noqa: E402
from OCC.Core.BRepPrimAPI import BRepPrimAPI_MakeBox, BRepPrimAPI_MakeCylinder  # noqa: E402
from OCC.Core.TopAbs import TopAbs_EDGE  # noqa: E402
from OCC.Core.TopExp import TopExp_Explorer  # noqa: E402
from OCC.Core.TopoDS import topods  # noqa: E402
from OCC.Core.gp import gp_Pnt  # noqa: E402

from shared.face_attributes import build_face_attributes  # noqa: E402


def _counts(edges):
    out = {}
    for e in edges:
        out[e["convexity"]] = out.get(e["convexity"], 0) + 1
    return out


def test_box_is_all_convex_planes():
    attrs, edges = build_face_attributes(BRepPrimAPI_MakeBox(10.0, 20.0, 30.0).Shape())
    assert len(attrs) == 6 and all(a["surface_type"] == "plane" for a in attrs)
    assert sum(a["area_mm2"] for a in attrs) == pytest.approx(2 * (200 + 300 + 600), abs=0.01)
    assert _counts(edges) == {"convex": 12}
    assert all(e["dihedral_deg"] == pytest.approx(90.0, abs=0.1) for e in edges)


def test_pocket_walls_meet_floor_concave():
    box = BRepPrimAPI_MakeBox(40.0, 40.0, 10.0).Shape()
    pocket = BRepPrimAPI_MakeBox(gp_Pnt(10, 10, 5), 20.0, 20.0, 10.0).Shape()
    shape = BRepAlgoAPI_Cut(box, pocket).Shape()
    _, edges = build_face_attributes(shape)
    counts = _counts(edges)
    # 4 wall <-> floor edges + 4 wall <-> wall corners inside the pocket
    assert counts["concave"] == 8, counts
    assert counts["convex"] == 12 + 4, counts  # outer box + pocket rim


def test_fillet_edges_are_smooth():
    box = BRepPrimAPI_MakeBox(20.0, 20.0, 20.0).Shape()
    fillet = BRepFilletAPI_MakeFillet(box)
    exp = TopExp_Explorer(box, TopAbs_EDGE)
    fillet.Add(2.0, topods.Edge(exp.Current()))
    attrs, edges = build_face_attributes(fillet.Shape())
    assert any(a["surface_type"] == "cylinder" for a in attrs)
    assert _counts(edges).get("smooth", 0) == 2


def test_cylinder_seam_omitted_rims_convex():
    attrs, edges = build_face_attributes(BRepPrimAPI_MakeCylinder(5.0, 20.0).Shape())
    assert sorted(a["surface_type"] for a in attrs) == ["cylinder", "plane", "plane"]
    assert _counts(edges) == {"convex": 2}
    cyl = next(a for a in attrs if a["surface_type"] == "cylinder")
    assert cyl["radius_mm"] == pytest.approx(5.0)
