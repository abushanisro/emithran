"""
Rib heights: each wall face carries its extent along the pull (from its vertices), and a rib pair's height is the overlap of its two walls' extents.
The backend compares the heights with machinedRibThreshold (ribs too tall to machine need an EDM'd insert, formula registry G-04).

Run: docker compose -f docker-compose.dev.yml --profile test run --rm tests pytest test/test_rib_heights.py
"""
from OCC.Core.BRepPrimAPI import BRepPrimAPI_MakeBox
from OCC.Core.gp import gp_Pnt

from injection_molding.feature_extractor import InjectionMoldedFeatureExtractor
from shared.draft_angle_geometry import analyze_draft_angles


def box(x, y, z, at=(0, 0, 0)):
    return BRepPrimAPI_MakeBox(gp_Pnt(*at), x, y, z).Shape()


def test_every_wall_face_carries_its_extent_along_the_pull():
    out = analyze_draft_angles(box(100, 60, 20, at=(0, 0, 5)), [100.0, 60.0, 20.0], undrafted_threshold_deg=0.3, undercut_threshold_deg=5.0)
    planes = out["_wall_face_planes"]
    assert len(planes) == 4  # the four side walls; the top and bottom face the pull
    for p in planes:
        assert len(p) == 10
        lo, hi = p[8], p[9]
        assert abs(lo - 5.0) < 1e-6 and abs(hi - 25.0) < 1e-6


def _plane(n, offset, lo, hi, area=100.0):
    # (nx, ny, nz, offset, area, cx, cy, cz, lo, hi): the shape analyze_draft_angles collects
    return (*n, offset, area, 0.0, 0.0, 0.0, lo, hi)


def test_a_rib_pair_is_as_tall_as_its_two_walls_overlap_and_the_groups_carry_the_heights():
    ex = InjectionMoldedFeatureExtractor()
    planes = [
        # a 1.0 mm rib, walls from z 2 to 30 and 2 to 28: 26 mm tall
        _plane((1, 0, 0), 10.0, 2.0, 30.0), _plane((-1, 0, 0), -11.0, 2.0, 28.0),
        # a 1.0 mm rib 12 mm tall
        _plane((0, 1, 0), 40.0, 2.0, 14.0), _plane((0, -1, 0), -41.0, 2.0, 14.0),
    ]
    out = ex._detect_ribs(planes, nominal_wall_mm=2.0)
    assert out["rib_count"] == 2
    assert sorted(r["height_mm"] for r in out["rib_data"]) == [12.0, 26.0]
    assert all(r["height_source"] == "measured_along_pull" for r in out["rib_data"])
    assert out["rib_groups"] == [{"thickness_mm": 1.0, "count": 2, "heights_mm": [12.0, 26.0], "max_height_mm": 26.0}]


def test_without_extents_the_height_is_not_measured_and_the_group_says_so():
    ex = InjectionMoldedFeatureExtractor()
    planes = [(1, 0, 0, 10.0, 100.0, 0, 0, 0), (-1, 0, 0, -11.0, 100.0, 0, 0, 0)]
    out = ex._detect_ribs(planes, nominal_wall_mm=2.0)
    assert out["rib_data"][0]["height_source"] == "estimated_from_area"
    assert out["rib_groups"] == [{"thickness_mm": 1.0, "count": 1, "heights_mm": [], "max_height_mm": None}]
