"""
The plastic recognition core on synthetic parts with known answers (OpenCASCADE solids built in the test): the surface census, the mold-opening
direction found from all surfaces, draft on planar, conical and free-form (B-spline) walls, and undercut by visibility.

Run: docker compose -f docker-compose.dev.yml --profile test run --rm tests pytest test/test_plastic_recognition_core.py
"""
import math

import pytest
from OCC.Core.BRepAlgoAPI import BRepAlgoAPI_Cut
from OCC.Core.BRepBuilderAPI import BRepBuilderAPI_NurbsConvert, BRepBuilderAPI_Transform
from OCC.Core.BRepGProp import brepgprop
from OCC.Core.BRepPrimAPI import BRepPrimAPI_MakeBox, BRepPrimAPI_MakeCone, BRepPrimAPI_MakeCylinder
from OCC.Core.GProp import GProp_GProps
from OCC.Core.gp import gp_Ax1, gp_Ax2, gp_Dir, gp_Pnt, gp_Trsf

from injection_molding.recognition.census import surface_census
from injection_molding.recognition.core import recognize_core
from injection_molding.recognition.draft import analyze_draft
from injection_molding.recognition.mesh import tessellate_faces
from injection_molding.recognition.pull_direction import angle_between_axes_deg, candidate_directions, canonical, choose_pull_direction

UNDRAFTED, MAX_DRAFT = 0.3, 5.0


def box(x, y, z, at=(0, 0, 0)):
    return BRepPrimAPI_MakeBox(gp_Pnt(*at), x, y, z).Shape()


def hole(at, axis, radius, length):
    return BRepPrimAPI_MakeCylinder(gp_Ax2(gp_Pnt(*at), gp_Dir(*axis)), radius, length).Shape()


def cut(shape, *tools):
    for t in tools:
        shape = BRepAlgoAPI_Cut(shape, t).Shape()
    return shape


def area(shape):
    p = GProp_GProps()
    brepgprop.SurfaceProperties(shape, p)
    return p.Mass()


def meshes(shape):
    return tessellate_faces(shape, linear_deflection=0.05)


def rotated(shape, about_x_deg=0.0, about_y_deg=0.0):
    out = shape
    for axis, deg in ((gp_Ax1(gp_Pnt(0, 0, 0), gp_Dir(1, 0, 0)), about_x_deg), (gp_Ax1(gp_Pnt(0, 0, 0), gp_Dir(0, 1, 0)), about_y_deg)):
        if deg:
            t = gp_Trsf()
            t.SetRotation(axis, math.radians(deg))
            out = BRepBuilderAPI_Transform(out, t, True).Shape()
    return out


class TestMeshAndCensus:
    def test_normals_point_out_of_the_material_including_hole_walls(self):
        part = cut(box(100, 60, 10), hole((50, 30, -1), (0, 0, 1), 5, 12))
        wrong = 0
        for f in meshes(part):
            for t in f.triangles:
                if f.surface == "cylinder":  # the hole wall faces the axis
                    wrong += t.normal[0] * (t.centroid[0] - 50) + t.normal[1] * (t.centroid[1] - 30) > 0
                else:
                    wrong += sum(t.normal[i] * (t.centroid[i] - c) for i, c in enumerate((50, 30, 5))) <= 0
        assert wrong == 0

    def test_census_counts_every_surface_type_and_the_area_matches_the_solid(self):
        part = cut(box(100, 60, 10), hole((50, 30, -1), (0, 0, 1), 5, 12))
        census = surface_census(meshes(part))
        assert census["by_surface"]["plane"]["faces"] == 6
        assert census["by_surface"]["cylinder"]["faces"] == 1
        assert census["unmeshed_faces"] == 0
        assert census["area_mm2"] == pytest.approx(area(part), rel=0.01)


class TestPullDirection:
    def test_a_plate_with_a_through_hole_opens_along_the_hole(self):
        pull = choose_pull_direction(meshes(cut(box(100, 60, 10), hole((50, 30, -1), (0, 0, 1), 5, 12))), UNDRAFTED)
        assert pull.nearest_axis() == "z"
        assert pull.undercut_area_mm2 == pytest.approx(0.0, abs=1.0)
        assert pull.source == "auto"

    def test_the_direction_is_found_when_the_part_is_rotated_off_every_axis(self):
        # Rotating 30 deg about X and 20 deg about Y: no axis is the pull any more, the part's own face directions are.
        part = rotated(cut(box(100, 60, 10), hole((50, 30, -1), (0, 0, 1), 5, 12)), 30, 20)
        pull = choose_pull_direction(meshes(part), UNDRAFTED)
        expected = canonical(_rotate_z(30, 20))
        assert angle_between_axes_deg(pull.vector, expected) < 3.0
        assert pull.nearest_axis() is None
        assert pull.undercut_area_mm2 == pytest.approx(0.0, abs=2.0)

    def test_a_blind_side_hole_makes_its_own_axis_the_pull_not_the_largest_face(self):
        part = cut(box(100, 60, 20), hole((101, 30, 10), (-1, 0, 0), 4, 30))  # blind hole in the +X face
        pull = choose_pull_direction(meshes(part), UNDRAFTED)
        assert pull.nearest_axis() == "x"
        # A few square millimetres of tessellation noise at the hole's rim on a 7,000 mm2 part is not an undercut.
        assert pull.undercut_area_mm2 == pytest.approx(0.0, abs=5.0)

    def test_the_engineers_override_is_used_and_still_measured(self):
        part = cut(box(100, 60, 20), hole((101, 30, 10), (-1, 0, 0), 4, 30))
        pull = choose_pull_direction(meshes(part), UNDRAFTED, override=(0.0, 0.0, 1.0))
        assert pull.source == "override"
        assert pull.nearest_axis() == "z"
        assert pull.undercut_area_mm2 > 50.0  # the hole wall is covered along Z: what the override costs is visible

    def test_a_groove_in_a_side_wall_is_an_undercut_along_the_other_axis_by_its_wall_area(self):
        # 5 mm wide, 3 mm deep groove across the whole +X face, running along Y (60 mm), centred in Z.
        part = cut(box(100, 60, 20), box(3, 60, 5, at=(97, 0, 7.5)))
        along_z = choose_pull_direction(meshes(part), UNDRAFTED, override=(0, 0, 1)).undercut_area_mm2
        along_x = choose_pull_direction(meshes(part), UNDRAFTED, override=(1, 0, 0)).undercut_area_mm2
        assert along_x == pytest.approx(0.0, abs=1.0)
        # Its roof faces down and its floor faces up, each 3 x 60 mm, both covered by the wall above and below them.
        assert along_z == pytest.approx(2 * 3 * 60, rel=0.15)

    def test_the_draft_analysis_counts_the_covered_floor_and_roof_of_a_groove_as_undercut_faces(self):
        # The groove's roof and floor are square to the Z pull (a floor and a lid are normally left out of the draft analysis), but both are covered.
        part = cut(box(100, 60, 20), box(3, 60, 5, at=(97, 0, 7.5)))
        out = analyze_draft(meshes(part), (0, 0, 1), UNDRAFTED, MAX_DRAFT)
        assert out["faces_by_class"]["undercut"] == 2
        assert out["area_by_class_mm2"]["undercut"] == pytest.approx(2 * 3 * 60, rel=0.15)

    def test_candidates_include_the_three_axes_and_the_dominant_face_directions_once_each(self):
        part = rotated(box(100, 60, 10), 30, 20)
        found = candidate_directions(meshes(part))
        assert len(found) >= 4
        for i, a in enumerate(found):
            for b in found[i + 1:]:
                assert angle_between_axes_deg(a, b) > 1.0


def _rotate_z(about_x_deg: float, about_y_deg: float):
    """Where the part's own Z axis points after the two rotations rotated() applies (X first, then Y)."""
    ax, ay = math.radians(about_x_deg), math.radians(about_y_deg)
    x, y, z = 0.0, 0.0, 1.0
    y, z = y * math.cos(ax) - z * math.sin(ax), y * math.sin(ax) + z * math.cos(ax)
    x, z = x * math.cos(ay) + z * math.sin(ay), -x * math.sin(ay) + z * math.cos(ay)
    return (x, y, z)


class TestDraft:
    HEIGHT = 50.0

    def frustum(self, draft_deg):
        r2 = 20.0 - self.HEIGHT * math.tan(math.radians(draft_deg))
        return BRepPrimAPI_MakeCone(gp_Ax2(gp_Pnt(0, 0, 0), gp_Dir(0, 0, 1)), 20.0, r2, self.HEIGHT).Shape()

    def wall_draft(self, shape):
        m = meshes(shape)
        out = analyze_draft(m, (0, 0, 1), UNDRAFTED, MAX_DRAFT)
        return out

    def test_a_conical_wall_measures_its_own_draft(self):
        out = self.wall_draft(self.frustum(3.0))
        assert out["avg_draft_angle_deg"] == pytest.approx(3.0, abs=0.3)
        assert out["faces_by_class"]["drafted"] == 1
        assert out["faces_by_class"]["undercut"] == 0

    def test_a_free_form_bspline_wall_is_measured_too(self):
        shape = BRepBuilderAPI_NurbsConvert(self.frustum(3.0), True).Shape()
        assert {f.surface for f in meshes(shape)} >= {"bspline"}
        out = self.wall_draft(shape)
        assert out["avg_draft_angle_deg"] == pytest.approx(3.0, abs=0.3)
        assert out["faces_by_class"]["drafted"] >= 1

    def test_a_straight_cylinder_wall_is_undrafted(self):
        out = self.wall_draft(BRepPrimAPI_MakeCylinder(gp_Ax2(gp_Pnt(0, 0, 0), gp_Dir(0, 0, 1)), 20.0, 50.0).Shape())
        assert out["faces_by_class"]["undrafted"] == 1
        assert out["avg_draft_angle_deg"] == pytest.approx(0.0, abs=0.1)
        assert out["parting_complexity"] == pytest.approx(0.5, abs=0.01)  # every wall undrafted: half weight

    def test_a_heavily_drafted_wall_is_overdrafted(self):
        out = self.wall_draft(self.frustum(8.0))
        assert out["faces_by_class"]["overdrafted"] == 1


def test_recognize_core_reports_the_census_the_direction_and_the_draft_together():
    part = cut(box(100, 60, 10), hole((50, 30, -1), (0, 0, 1), 5, 12))
    out = recognize_core(part, [100, 60, 10], UNDRAFTED, MAX_DRAFT)
    assert out["version"] == "plastic_recognition_core_v1"
    assert out["pull_direction"]["axis"] == "z"
    assert out["surface_census"]["faces"] == 7
    assert out["draft"]["faces_by_class"]["undrafted"] >= 4  # the box walls and the hole wall have no draft
