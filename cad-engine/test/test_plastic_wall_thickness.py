"""Wall thickness at every face, on parts whose walls are known without running anything."""
import pytest

pytest.importorskip("OCC")

from OCC.Core.BRepAlgoAPI import BRepAlgoAPI_Cut, BRepAlgoAPI_Fuse  # noqa: E402
from OCC.Core.BRepPrimAPI import BRepPrimAPI_MakeBox, BRepPrimAPI_MakeCylinder  # noqa: E402
from OCC.Core.gp import gp_Ax2, gp_Dir, gp_Pnt  # noqa: E402

from injection_molding.recognition.mesh import tessellate_faces  # noqa: E402
from injection_molding.recognition.wall_thickness import measure_wall_thickness, samples_per_face  # noqa: E402


def _box(x, y, z, dx, dy, dz):
    return BRepPrimAPI_MakeBox(gp_Pnt(x, y, z), dx, dy, dz).Shape()


def _measure(shape):
    meshes = tessellate_faces(shape, linear_deflection=0.1)
    out = measure_wall_thickness(meshes, 0.1)
    return meshes, {f["face_id"]: f for f in out["faces"]}, out


def test_a_solid_block_is_as_thick_as_its_smallest_dimension_at_every_face():
    # the largest ball inside a 40 x 30 x 20 block is 20 across, wherever it touches
    meshes, wall, out = _measure(_box(0, 0, 0, 40, 30, 20))
    assert out["missed"] == 0 and len(wall) == 6
    assert [f["thickness_mm"] for f in wall.values()] == pytest.approx([20.0] * 6, abs=0.3)


def test_a_shell_is_its_wall_everywhere_including_the_end_of_the_wall_and_a_rib_is_its_own_thickness():
    tray = BRepAlgoAPI_Cut(_box(-50, -30, 0, 100, 60, 15), _box(-47.5, -27.5, 2.5, 95, 55, 15)).Shape()
    plain = _measure(tray)[1]
    # every face of the tray sits on the 2.5 mm wall, the rim top (the end of the wall, 15 mm tall) included
    assert [f["thickness_mm"] for f in plain.values()] == pytest.approx([2.5] * len(plain), abs=0.05)
    ribbed = BRepAlgoAPI_Fuse(tray, _box(-47.5, -0.75, 2.5, 95, 1.5, 10)).Shape()
    thicknesses = sorted({round(f["thickness_mm"], 1) for f in _measure(ribbed)[1].values()})
    assert thicknesses[0] == 1.5 and 2.5 in thicknesses  # the rib faces; the rib's top is 1.5 wide


def test_a_thick_boss_is_found_thicker_than_the_wall():
    tray = BRepAlgoAPI_Cut(_box(-50, -30, 0, 100, 60, 15), _box(-47.5, -27.5, 2.5, 95, 55, 15)).Shape()
    boss = BRepPrimAPI_MakeCylinder(gp_Ax2(gp_Pnt(0, 0, 2.5), gp_Dir(0, 0, 1)), 6.0, 10.0).Shape()
    meshes, wall, _ = _measure(BRepAlgoAPI_Fuse(tray, boss).Shape())
    side = [wall[m.index] for m in meshes if m.surface == "cylinder" and m.index in wall]
    assert side and max(f["thickness_mm"] for f in side) > 6.0  # a 12 mm boss, fully 12 only where a 12 mm ball fits
    assert max(f["thickness_mm"] for f in wall.values() if f not in side) < 13


def test_the_resolution_and_the_misses_are_reported_and_nothing_is_guessed_for_an_empty_part():
    out = measure_wall_thickness([], 0.2)
    assert out["faces"] == [] and out["rays"] == 0 and out["resolution_mm"] == 0.2


def test_a_face_is_never_judged_by_one_point_however_many_faces_the_part_has():
    # the Back cover: 959 faces, 19,283 triangles. A budget divided over the faces left ONE sample each, and a small curved face read 0.36 mm from its largest triangle
    # while other points of the same face read 1.9 mm: about 30 percent of its thin faces were that noise.
    assert samples_per_face(959, 19_283) >= 4
    assert samples_per_face(959, 19_283) <= 6
    # a very large mesh gets fewer, never fewer than three
    assert samples_per_face(5_000, 2_000_000) == 3
    # a small part gets the most
    assert samples_per_face(11, 400) == 6


def test_every_face_of_a_part_is_sampled_at_several_points():
    tray = BRepAlgoAPI_Cut(_box(-50, -30, 0, 100, 60, 15), _box(-47.5, -27.5, 2.5, 95, 55, 15)).Shape()
    meshes = tessellate_faces(tray, linear_deflection=0.1)
    out = measure_wall_thickness(meshes, 0.1)
    assert all(f["samples"] >= 3 for f in out["faces"])
