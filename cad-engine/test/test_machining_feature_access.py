import pytest

pytest.importorskip("OCC")

from OCC.Core.BRepAlgoAPI import BRepAlgoAPI_Cut  # noqa: E402
from OCC.Core.BRepFilletAPI import BRepFilletAPI_MakeFillet  # noqa: E402
from OCC.Core.BRepPrimAPI import BRepPrimAPI_MakeBox, BRepPrimAPI_MakeCylinder  # noqa: E402
from OCC.Core.TopAbs import TopAbs_EDGE  # noqa: E402
from OCC.Core.TopExp import TopExp_Explorer  # noqa: E402
from OCC.Core.gp import gp_Ax2, gp_Dir, gp_Pnt  # noqa: E402

from injection_molding.recognition.mesh import tessellate_faces  # noqa: E402
from machining.feature_access import annotate_access_from_meshes  # noqa: E402

# A 60 x 50 x 20 block. Blind hole Ø8 from the top, 10 deep. Through hole Ø8. A 20 x 12 pocket 6 deep from the
# top with R3 vertical corners, its long wall 1.5 mm from the block's side (y = 0).
POCKET_DEPTH = 6.0
CORNER_R = 3.0


def _pocket_tool():
    box = BRepPrimAPI_MakeBox(gp_Pnt(5.0, 1.5, 20.0 - POCKET_DEPTH), 20.0, 12.0, POCKET_DEPTH + 1.0).Shape()
    fillet = BRepFilletAPI_MakeFillet(box)
    exp = TopExp_Explorer(box, TopAbs_EDGE)
    seen = []
    while exp.More():
        edge = exp.Current()
        # the four vertical edges: both ends share x and y
        from OCC.Core.BRepAdaptor import BRepAdaptor_Curve
        c = BRepAdaptor_Curve(edge)
        a, b = c.Value(c.FirstParameter()), c.Value(c.LastParameter())
        key = (round(a.X(), 3), round(a.Y(), 3))
        if abs(a.X() - b.X()) < 1e-6 and abs(a.Y() - b.Y()) < 1e-6 and key not in seen:
            seen.append(key)
            fillet.Add(CORNER_R, edge)
        exp.Next()
    return fillet.Shape()


@pytest.fixture(scope="module")
def part():
    shape = BRepPrimAPI_MakeBox(60.0, 50.0, 20.0).Shape()
    blind = BRepPrimAPI_MakeCylinder(gp_Ax2(gp_Pnt(45, 35, 10), gp_Dir(0, 0, 1)), 4.0, 11.0).Shape()
    through = BRepPrimAPI_MakeCylinder(gp_Ax2(gp_Pnt(45, 15, -1), gp_Dir(0, 0, 1)), 4.0, 22.0).Shape()
    for tool in (blind, through, _pocket_tool()):
        shape = BRepAlgoAPI_Cut(shape, tool).Shape()
    meshes = tessellate_faces(shape, linear_deflection=0.1)
    return meshes


def _cylinder_at(meshes, x, y, radius=4.0):
    return next(f.index for f in meshes if f.surface == "cylinder" and abs(f.revolved.radius - radius) < 1e-6
                and abs(f.revolved.axis_point[0] - x) < 1e-6 and abs(f.revolved.axis_point[1] - y) < 1e-6)


def _pocket_floor(meshes):
    z = 20.0 - POCKET_DEPTH
    return next(f.index for f in meshes if f.surface == "plane" and f.triangles and all(abs(v[2] - z) < 1e-6 for t in f.triangles for v in t.vertices))


def _annotate(meshes, feature_type, face_id, variant="default"):
    occ = {"face_ids": [face_id]}
    annotate_access_from_meshes(meshes, [{"feature_type": feature_type, "variant": variant, "occurrences": [occ]}], 0.1)
    return occ


def test_blind_hole_is_approached_out_of_its_open_end(part):
    occ = _annotate(part, "SimpleHole", _cylinder_at(part, 45, 35), "blind")
    assert occ["tool_axis"] == pytest.approx([0.0, 0.0, 1.0], abs=1e-4)
    assert occ["tool_axis_bidirectional"] is False


def test_through_hole_is_reachable_from_either_end(part):
    occ = _annotate(part, "SimpleHole", _cylinder_at(part, 45, 15), "through")
    assert abs(occ["tool_axis"][2]) == pytest.approx(1.0, abs=1e-4)
    assert occ["tool_axis_bidirectional"] is True


def test_pocket_is_approached_along_its_floor_normal_and_reports_its_tightest_corner(part):
    occ = _annotate(part, "PocketV2", _pocket_floor(part))
    assert occ["tool_axis"] == pytest.approx([0.0, 0.0, 1.0], abs=1e-4)
    assert occ["tool_axis_bidirectional"] is False
    assert occ["corner_radius_mm"] == pytest.approx(CORNER_R, abs=1e-3)


def test_wall_behind_a_feature_is_measured(part):
    # Under the pocket floor: 20 - 6 = 14 mm of material.
    assert _annotate(part, "PocketV2", _pocket_floor(part))["min_wall_mm"] == pytest.approx(14.0, abs=0.3)
    # The pocket's long wall is 1.5 mm from the block's side.
    wall = next(f.index for f in part if f.surface == "plane" and f.triangles and all(abs(v[1] - 1.5) < 1e-6 for t in f.triangles for v in t.vertices))
    assert _annotate(part, "PlanarFace", wall)["min_wall_mm"] == pytest.approx(1.5, abs=0.2)


def test_a_surface_region_gets_no_tool_axis_and_a_pocket_with_no_corner_no_radius(part):
    top = next(f.index for f in part if f.surface == "plane" and f.triangles and all(abs(v[2] - 20.0) < 1e-6 for t in f.triangles for v in t.vertices))
    occ = _annotate(part, "PlanarFace", top)
    assert "tool_axis" not in occ
    # The block's top is a plane with no concave cylinder standing on it that rises above it.
    assert "corner_radius_mm" not in _annotate(part, "PocketV2", top)


def test_a_pocket_whose_walls_meet_sharp_reports_a_zero_corner_radius():
    from shared.edge_length import sharp_edge_length

    shape = BRepPrimAPI_MakeBox(60.0, 50.0, 20.0).Shape()
    square = BRepPrimAPI_MakeBox(gp_Pnt(10.0, 10.0, 14.0), 20.0, 12.0, 7.0).Shape()
    shape = BRepAlgoAPI_Cut(shape, square).Shape()
    meshes = tessellate_faces(shape, linear_deflection=0.1)
    floor = next(f.index for f in meshes if f.surface == "plane" and f.triangles and all(abs(v[2] - 14.0) < 1e-6 for t in f.triangles for v in t.vertices))
    edges = sharp_edge_length(shape, detail=True, concavity=True)["edges"]
    occ = {"face_ids": [floor]}
    annotate_access_from_meshes(meshes, [{"feature_type": "PocketV2", "variant": "default", "occurrences": [occ]}], 0.1, edges)
    assert occ["corner_radius_mm"] == 0.0
    # Without the edge classification a sharp corner is not looked for: no radius is reported, not a wrong one.
    blind = {"face_ids": [floor]}
    annotate_access_from_meshes(meshes, [{"feature_type": "PocketV2", "variant": "default", "occurrences": [blind]}], 0.1)
    assert "corner_radius_mm" not in blind


def test_a_filleted_pocket_is_not_sharp(part):
    # the module fixture's pocket has R3 corners: its walls meet the corner arcs tangent, so no sharp inside edge stands on its floor
    occ = {"face_ids": [_pocket_floor(part)]}
    annotate_access_from_meshes(part, [{"feature_type": "PocketV2", "variant": "default", "occurrences": [occ]}], 0.1, [])
    assert occ["corner_radius_mm"] == pytest.approx(CORNER_R, abs=1e-3)

