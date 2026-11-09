"""
Forging geometry extractor: generated solids whose answers are worked out by hand (the arithmetic is in each test).

Stated tolerances (the extractor tessellates at 0.05 mm, so curved figures are mesh-limited; planar figures are exact):
  silhouette area ............ 1.0 %      (a circle's inscribed polygon is short by (2*pi^2/3)/n^2: 0.2 % at R = 40)
  parting perimeter .......... 0.5 %
  draft angle ................ 0.05 deg  (exact surface normals, so in practice ~1e-4 deg)
  die-locked area ............ 1.0 %
  A(x) and its integral ...... 1.0 %
  zero-draft / below-threshold area, planar faces ... 0.1 %; curved faces are sampled (16 per face), and the figure
                                          is checked to 1 %.
Run: docker compose -f docker-compose.dev.yml --profile test run --rm tests python -m pytest test/test_forging_geometry.py -q
"""
import copy
import json
import math
import pathlib

import pytest

pytest.importorskip("OCC")

from OCC.Core.BRepAlgoAPI import BRepAlgoAPI_Cut, BRepAlgoAPI_Fuse
from OCC.Core.BRepPrimAPI import BRepPrimAPI_MakeBox, BRepPrimAPI_MakeCone, BRepPrimAPI_MakeCylinder
from OCC.Core.gp import gp_Ax2, gp_Dir, gp_Pnt

from forging import DRAFT_THRESHOLD_DEG, EXTRACTOR_VERSION, SCHEMA_VERSION, extract_forging_geometry

AREA, PERIM, DRAFT, LOCK, SECTION = 0.01, 0.005, 0.05, 0.01, 0.01


def _extract(shape, **kw):
    kw.setdefault("include_wall_thickness", False)
    return extract_forging_geometry(shape, **kw)


def _axis(payload, name):
    return next(a for a in payload["pull"]["axes"] if a["axis"] == name)


def _cyl(radius, height, z0=0.0):
    return BRepPrimAPI_MakeCylinder(gp_Ax2(gp_Pnt(0, 0, z0), gp_Dir(0, 0, 1)), radius, height).Shape()


@pytest.fixture(scope="module")
def box():
    return _extract(BRepPrimAPI_MakeBox(60.0, 50.0, 40.0).Shape())


@pytest.fixture(scope="module")
def puck():  # R 40, h 20
    return _extract(_cyl(40.0, 20.0))


@pytest.fixture(scope="module")
def rod():  # R 20, h 50
    return _extract(_cyl(20.0, 50.0))


@pytest.fixture(scope="module")
def flanged():  # flange R 40 x 10, hub R 15 x 30 on top
    return _extract(BRepAlgoAPI_Fuse(_cyl(40.0, 10.0), _cyl(15.0, 30.0, z0=10.0)).Shape(), section_axis="z", section_stations=40)


@pytest.fixture(scope="module")
def cross_hole():  # 60 x 50 x 40 block with a 10 mm hole through it along x (a die lock for a z or y pull)
    block = BRepPrimAPI_MakeBox(60.0, 50.0, 40.0).Shape()
    tool = BRepPrimAPI_MakeCylinder(gp_Ax2(gp_Pnt(-1, 25, 20), gp_Dir(1, 0, 0)), 5.0, 62.0).Shape()
    return _extract(BRepAlgoAPI_Cut(block, tool).Shape())


# --------------------------------------------------------------------------------------------- box

def test_box_silhouette_perimeter_and_footprint_on_every_axis(box):
    # box 60 (x) x 50 (y) x 40 (z): silhouette = the two other sides
    for name, area, perim in (("x", 50 * 40, 2 * (50 + 40)), ("y", 60 * 40, 2 * (60 + 40)), ("z", 60 * 50, 2 * (60 + 50))):
        s = _axis(box, name)["silhouette"]
        assert s["projected_area_mm2"] == pytest.approx(area, rel=1e-6)
        assert s["parting_perimeter_mm"] == pytest.approx(perim, rel=1e-6)


def test_box_has_no_die_lock_and_its_walls_have_zero_draft(box):
    # pull z: the four side walls are parallel to the pull: 2 * (60 + 50) * 40 = 8800 mm2; the top and bottom are 90 deg
    z = _axis(box, "z")
    assert not z["die_lock"]["has_die_lock"]
    assert z["draft"]["zero_draft_area_mm2"] == pytest.approx(2 * (60 + 50) * 40, rel=1e-3)
    assert z["draft"]["min_deg"] == pytest.approx(0.0, abs=DRAFT)
    assert box["pull"]["die_lock_free_axes"] == ["x", "y", "z"]


def test_box_pulls_along_its_shortest_dimension(box):
    # zero-draft area: x = 2*(50+40)*60 = 10800, y = 2*(60+40)*50 = 10000, z = 2*(60+50)*40 = 8800 -> z
    assert box["pull"]["chosen_axis"] == "z"
    assert box["pull"]["tied_axes"] == []
    z = {s["axis"]: s["zero_draft_area_mm2"] for s in box["pull"]["scores"]}
    assert z["x"] == pytest.approx(10800, rel=1e-3) and z["y"] == pytest.approx(10000, rel=1e-3) and z["z"] == pytest.approx(8800, rel=1e-3)


def test_box_measures(box):
    assert box["part"]["volume_mm3"] == pytest.approx(60 * 50 * 40, rel=1e-6)
    assert box["part"]["surface_area_mm2"] == pytest.approx(2 * (60 * 50 + 60 * 40 + 50 * 40), rel=1e-6)
    assert box["part"]["longitudinal_ratio"] == pytest.approx(60 / 50, rel=1e-6)


# --------------------------------------------------------------------------------------------- cylinders

def test_puck_silhouette_along_its_axis(puck):
    s = _axis(puck, "z")["silhouette"]
    assert s["projected_area_mm2"] == pytest.approx(math.pi * 40 ** 2, rel=AREA)  # 5026.55
    assert s["parting_perimeter_mm"] == pytest.approx(2 * math.pi * 40, rel=PERIM)  # 251.33
    assert s["pull_extent_mm"] == pytest.approx(20.0, rel=1e-6)


def test_puck_side_on_silhouette_is_a_rectangle(puck):
    s = _axis(puck, "x")["silhouette"]
    assert s["projected_area_mm2"] == pytest.approx(80 * 20, rel=AREA)
    assert s["parting_perimeter_mm"] == pytest.approx(2 * (80 + 20), rel=PERIM)


def test_puck_pulls_along_its_axis(puck):
    # z: lateral wall 2*pi*40*20 = 5026.5 is parallel to the pull; x: both discs 2*pi*40^2 = 10053 are.
    assert puck["pull"]["chosen_axis"] == "z"
    scores = {s["axis"]: s["zero_draft_area_mm2"] for s in puck["pull"]["scores"]}
    assert scores["z"] == pytest.approx(2 * math.pi * 40 * 20, rel=1e-3)
    assert scores["x"] == pytest.approx(2 * math.pi * 40 ** 2, rel=AREA)
    assert not any(a["die_lock"]["has_die_lock"] for a in puck["pull"]["axes"])


def test_rod_silhouette_and_lateral_zero_draft_area(rod):
    z = _axis(rod, "z")
    assert z["silhouette"]["projected_area_mm2"] == pytest.approx(math.pi * 20 ** 2, rel=AREA)  # 1256.64
    assert z["silhouette"]["parting_perimeter_mm"] == pytest.approx(2 * math.pi * 20, rel=PERIM)  # 125.66
    assert z["draft"]["zero_draft_area_mm2"] == pytest.approx(2 * math.pi * 20 * 50, rel=1e-3)  # 6283.2
    assert rod["part"]["volume_mm3"] == pytest.approx(math.pi * 20 ** 2 * 50, rel=1e-6)


# --------------------------------------------------------------------------------------------- flanged disc

def test_flanged_disc_silhouette_is_the_flange(flanged):
    s = _axis(flanged, "z")["silhouette"]
    assert s["projected_area_mm2"] == pytest.approx(math.pi * 40 ** 2, rel=AREA)
    assert s["parting_perimeter_mm"] == pytest.approx(2 * math.pi * 40, rel=PERIM)
    assert s["pull_extent_mm"] == pytest.approx(40.0, rel=1e-6)


def test_flanged_disc_zero_draft_is_both_lateral_walls_and_it_pulls_along_z(flanged):
    # flange wall 2*pi*40*10 = 2513.27 plus hub wall 2*pi*15*30 = 2827.43 = 5340.7
    assert flanged["pull"]["chosen_axis"] == "z"
    assert _axis(flanged, "z")["draft"]["zero_draft_area_mm2"] == pytest.approx(5340.7, rel=1e-3)
    assert flanged["pull"]["die_lock_free_axes"] == ["x", "y", "z"]


def test_flanged_disc_is_a_surface_of_revolution_about_z(flanged):
    r = flanged["revolution"]
    assert r["best_axis"] == "z"
    assert r["by_axis"]["z"] == pytest.approx(1.0, abs=1e-6)  # every face is a disc, annulus or cylinder about z
    assert r["by_axis"]["x"] < 0.5 and r["by_axis"]["y"] < 0.5
    assert flanged["blends"]["blend_count"] == 0 and flanged["holes"] == []


def test_flanged_disc_section_curve_matches_the_two_radii(flanged):
    # A = pi*40^2 = 5026.55 for z < 10 and pi*15^2 = 706.86 above; 40 stations of 1 mm put the step on a cell boundary
    sec = flanged["sections"]
    assert sec["axis"] == "z" and sec["stations"] == 40
    for x, a in zip(sec["x_mm"], sec["area_mm2"]):
        assert a == pytest.approx(math.pi * (40 ** 2 if x < 10 else 15 ** 2), rel=SECTION)
    assert sec["volume_check_ratio"] == pytest.approx(1.0, abs=SECTION)
    assert sec["max_area_mm2"] == pytest.approx(math.pi * 1600, rel=SECTION)


# --------------------------------------------------------------------------------------------- stepped shaft: A(x)

def test_stepped_shaft_section_curve_and_radius_variation():
    # R 10 for z < 30, R 20 for 30 <= z < 50; 50 stations of 1 mm. Equivalent radius: 30 stations of 10 and 20 of 20 ->
    # mean (300 + 400) / 50 = 14; variance (30*16 + 20*36) / 50 = 24; CV = sqrt(24) / 14 = 0.3499
    shaft = _extract(BRepAlgoAPI_Fuse(_cyl(10.0, 30.0), _cyl(20.0, 20.0, z0=30.0)).Shape(), section_axis="z", section_stations=50)
    sec = shaft["sections"]
    for x, a in zip(sec["x_mm"], sec["area_mm2"]):
        assert a == pytest.approx(math.pi * (100 if x < 30 else 400), rel=SECTION)
    assert sec["volume_check_ratio"] == pytest.approx(1.0, abs=SECTION)
    eq = sec["equivalent_radius"]
    assert eq["mean_mm"] == pytest.approx(14.0, rel=SECTION)
    assert eq["coefficient_of_variation"] == pytest.approx(math.sqrt(24) / 14, rel=0.02)


def test_section_axis_auto_is_the_longest_extent(rod, puck):
    assert rod["sections"]["axis"] == "z"   # 50 long
    assert puck["sections"]["axis"] in ("x", "y")  # 80 across beats 20 high


# --------------------------------------------------------------------------------------------- draft

def test_a_five_degree_taper_measures_five_degrees():
    # frustum: R1 = 30 at z = 0 to R2 = 30 - 50 * tan(5 deg) at z = 50; the lateral wall leans 5 degrees from the pull
    r2 = 30.0 - 50.0 * math.tan(math.radians(5.0))
    p = _extract(BRepPrimAPI_MakeCone(30.0, r2, 50.0).Shape(), draft_thresholds_deg=[5.5, 4.5])
    z = _axis(p, "z")
    lateral = next(f for f in z["faces"] if f["surface_type"] == "cone")
    assert lateral["draft_min_deg"] == pytest.approx(5.0, abs=DRAFT)
    assert lateral["draft_max_deg"] == pytest.approx(5.0, abs=DRAFT)
    assert z["silhouette"]["projected_area_mm2"] == pytest.approx(math.pi * 30 ** 2, rel=AREA)
    assert z["silhouette"]["parting_perimeter_mm"] == pytest.approx(2 * math.pi * 30, rel=PERIM)
    slant = math.hypot(50.0, 30.0 - r2)
    lateral_area = math.pi * (30.0 + r2) * slant
    assert lateral["area_mm2"] == pytest.approx(lateral_area, rel=1e-4)
    # it is above 4.5 (not below it) and below 5.5 (all of it)
    assert z["draft"]["area_below_deg"]["5.5"] == pytest.approx(lateral_area, rel=1e-3)
    assert z["draft"]["area_below_deg"]["4.5"] == pytest.approx(0.0, abs=1.0)
    assert z["draft"]["zero_draft_area_mm2"] == pytest.approx(0.0, abs=1.0)
    assert not z["die_lock"]["has_die_lock"]


# --------------------------------------------------------------------------------------------- undercut / die lock

def test_a_cross_hole_is_a_die_lock_for_y_and_z_but_not_x(cross_hole):
    # hole wall 2*pi*5*60 = 1884.96 mm2. Pulled along z (or y) every point of it faces a die but sees the opposite wall.
    # Pulled along x the wall is parallel to the pull and the hole is simply open.
    wall = 2 * math.pi * 5 * 60
    for name in ("y", "z"):
        lock = _axis(cross_hole, name)["die_lock"]
        assert lock["has_die_lock"]
        assert lock["locked_area_mm2"] == pytest.approx(wall, rel=LOCK)
    x = _axis(cross_hole, "x")
    assert not x["die_lock"]["has_die_lock"] and x["die_lock"]["locked_area_mm2"] == 0.0
    assert cross_hole["pull"]["die_lock_free_axes"] == ["x"]
    assert cross_hole["pull"]["chosen_axis"] == "x"
    assert cross_hole["selected"]["has_die_lock"] is False


def test_the_silhouette_sees_through_a_hole_along_the_pull_but_not_across_it(cross_hole):
    x = _axis(cross_hole, "x")["silhouette"]
    assert x["projected_area_mm2"] == pytest.approx(50 * 40 - math.pi * 5 ** 2, rel=AREA)  # 1921.46
    assert x["parting_perimeter_mm"] == pytest.approx(2 * (50 + 40), rel=PERIM)  # the hole is an inner boundary: not counted
    assert _axis(cross_hole, "z")["silhouette"]["projected_area_mm2"] == pytest.approx(60 * 50, rel=1e-6)


def test_the_cross_hole_is_reported_as_a_bore_along_the_pull(cross_hole):
    assert len(cross_hole["holes"]) == 1
    h = cross_hole["holes"][0]
    assert h["diameter_mm"] == pytest.approx(10.0, abs=0.1) and h["blind"] is False
    assert h["axis_angle_to_pull_deg"] == pytest.approx(0.0, abs=0.01)
    assert cross_hole["blends"]["blend_count"] == 0  # the bore meets its end faces at a sharp edge


# --------------------------------------------------------------------------------------------- contract

def test_payload_is_versioned_json_and_deterministic(box):
    assert box["schema_version"] == SCHEMA_VERSION
    assert box["extractor"] == {"name": "forging_geometry", "version": EXTRACTOR_VERSION}
    assert box["parameters"]["draft_threshold_deg"] == DRAFT_THRESHOLD_DEG == 0.01
    assert json.loads(json.dumps(box)) == box
    again = _extract(BRepPrimAPI_MakeBox(60.0, 50.0, 40.0).Shape())
    assert again == box


def test_payload_matches_the_json_schema(box, cross_hole, flanged):
    jsonschema = pytest.importorskip("jsonschema")
    schema = json.loads((pathlib.Path(__file__).resolve().parents[1] / "contract" / "forging_geometry.schema.json").read_text())
    for p in (box, cross_hole, flanged):
        jsonschema.validate(p, schema)
    bad = copy.deepcopy(box)
    del bad["extractor"]
    with pytest.raises(jsonschema.ValidationError):
        jsonschema.validate(bad, schema)


def test_wall_thickness_carries_the_shadow_area():
    p = extract_forging_geometry(_cyl(40.0, 20.0))
    w = p["wall_thickness"]
    assert w["wall_thickness_min_mm"] == pytest.approx(20.0, abs=0.5)
    assert w["solid_shadow_area_mm2"] == p["selected"]["projected_area_mm2"]


# --------------------------------------------------------------------------------------------- user-supplied parts

_STEP_DIR = pathlib.Path(__file__).parent / "fixtures" / "forging"


@pytest.mark.parametrize("step", sorted(_STEP_DIR.glob("*.step")) if _STEP_DIR.exists() else [], ids=lambda p: p.name)
def test_user_supplied_step_part(step):
    """Real forged parts the user provides (test/fixtures/forging/NAME.step). An optional NAME.expected.json holds hand values:
    {"projected_area_mm2": ..., "parting_perimeter_mm": ..., "chosen_axis": "z", "has_die_lock": false, "tolerance": 0.02}."""
    from forging import extract_forging_geometry_from_step
    p = extract_forging_geometry_from_step(str(step))
    assert p["part"]["volume_mm3"] > 0 and p["sections"]["volume_check_ratio"] == pytest.approx(1.0, abs=0.05)
    expected = step.with_suffix(".expected.json")
    if expected.exists():
        e = json.loads(expected.read_text())
        tol = e.get("tolerance", 0.02)
        for key in ("projected_area_mm2", "parting_perimeter_mm"):
            if key in e:
                assert p["selected"][key] == pytest.approx(e[key], rel=tol)
        if "chosen_axis" in e:
            assert p["pull"]["chosen_axis"] == e["chosen_axis"]
        if "has_die_lock" in e:
            assert p["selected"]["has_die_lock"] is e["has_die_lock"]
